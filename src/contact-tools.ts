import * as z from 'zod/v4';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { appConfig } from './config';

const resendApiUrl = 'https://api.resend.com/emails';
const rateLimitKeyPrefix = 'ratelimit:send:';
const rateLimitWindowSeconds = 24 * 60 * 60;
const rateLimitMaxSends = 3;

type RegisterContactToolsOptions = {
  cacheKv?: KVNamespace;
  resendApiKey?: string;
  request: Request;
};

type RateLimitRecord = {
  count: number;
  resetAt: number;
};

type SendMessageInput = {
  sender_name: string;
  message: string;
  context?: string;
  reply_to_email?: string;
};

type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

type SendMessageDependencies = {
  cacheKv?: KVNamespace;
  resendApiKey?: string;
  request: Request;
  fetchFn?: (input: string, init?: RequestInit) => Promise<Response>;
};

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function getClientIp(request: Request) {
  const connectingIp = request.headers.get('cf-connecting-ip');
  if (connectingIp) return connectingIp.trim();

  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    const forwardedIp = forwardedFor.split(',')[0]?.trim();
    if (forwardedIp) return forwardedIp;
  }

  return 'unknown';
}

function buildEmailTextBody(input: SendMessageInput) {
  const lines = [
    `From: ${input.sender_name}`,
    input.reply_to_email ? `Reply-to email: ${input.reply_to_email}` : null,
    '',
    'Message:',
    input.message,
    input.context ? '' : null,
    input.context ? `Context: ${input.context}` : null,
    '',
    'Sent via folio.mcp.'
  ].filter((line): line is string => line !== null);

  return lines.join('\n');
}

function buildEmailHtmlBody(input: SendMessageInput) {
  const replyToBlock = input.reply_to_email
    ? `<p><strong>Reply-to email:</strong> ${escapeHtml(input.reply_to_email)}</p>`
    : '';

  const contextBlock = input.context
    ? `<p><strong>Context:</strong> ${escapeHtml(input.context)}</p>`
    : '';

  return `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827">
      <p><strong>From:</strong> ${escapeHtml(input.sender_name)}</p>
      ${replyToBlock}
      <p><strong>Message:</strong></p>
      <p style="white-space:pre-wrap">${escapeHtml(input.message)}</p>
      ${contextBlock}
      <p style="color:#6b7280;font-size:12px">Sent via folio.mcp.</p>
    </div>
  `.trim();
}

async function readRateLimitRecord(cacheKv: KVNamespace | undefined, key: string) {
  if (!cacheKv) return null;

  const record = await cacheKv.get(key, 'json');
  if (!record || typeof record !== 'object') return null;

  const candidate = record as Partial<RateLimitRecord>;
  if (typeof candidate.count !== 'number' || typeof candidate.resetAt !== 'number') return null;

  return candidate as RateLimitRecord;
}

async function enforceRateLimit(cacheKv: KVNamespace | undefined, ip: string): Promise<{ allowed: true } | { allowed: false; resetAt: number }> {
  if (!cacheKv) {
    return { allowed: true };
  }

  const key = `${rateLimitKeyPrefix}${ip}`;
  const now = Date.now();
  const existing = await readRateLimitRecord(cacheKv, key);

  if (!existing) {
    const initialRecord: RateLimitRecord = {
      count: 1,
      resetAt: now + rateLimitWindowSeconds * 1000
    };

    await cacheKv.put(key, JSON.stringify(initialRecord), {
      expiration: Math.ceil(initialRecord.resetAt / 1000)
    });

    return { allowed: true };
  }

  if (existing.resetAt <= now) {
    const resetRecord: RateLimitRecord = {
      count: 1,
      resetAt: now + rateLimitWindowSeconds * 1000
    };

    await cacheKv.put(key, JSON.stringify(resetRecord), {
      expiration: Math.ceil(resetRecord.resetAt / 1000)
    });

    return { allowed: true };
  }

  if (existing.count >= rateLimitMaxSends) {
    return { allowed: false, resetAt: existing.resetAt };
  }

  const updatedRecord: RateLimitRecord = {
    count: existing.count + 1,
    resetAt: existing.resetAt
  };

  await cacheKv.put(key, JSON.stringify(updatedRecord), {
    expiration: Math.ceil(existing.resetAt / 1000)
  });

  return { allowed: true };
}

function buildErrorResult(message: string): ToolResult {
  return {
    isError: true,
    content: [{ type: 'text', text: message }]
  };
}

export async function sendMessageViaResend(input: SendMessageInput, dependencies: SendMessageDependencies): Promise<ToolResult> {
  const resendApiKey = dependencies.resendApiKey?.trim();
  if (!resendApiKey) {
    return buildErrorResult('Email delivery is not configured right now because RESEND_API_KEY is missing.');
  }

  const ip = getClientIp(dependencies.request);
  const rateLimit = await enforceRateLimit(dependencies.cacheKv, ip);
  if (!rateLimit.allowed) {
    const resetAt = new Date(rateLimit.resetAt).toISOString();
    return buildErrorResult(`Rate limit exceeded. This IP can send at most ${rateLimitMaxSends} messages per 24 hours. Try again after ${resetAt}.`);
  }

  const subject = `folio.mcp message from ${input.sender_name}`;
  const payload = {
    from: appConfig.contact.resendFrom,
    to: [appConfig.contact.inboxEmail],
    subject,
    reply_to: input.reply_to_email,
    text: buildEmailTextBody(input),
    html: buildEmailHtmlBody(input)
  };

  let response: Response;
  try {
    response = await (dependencies.fetchFn ?? fetch)(resendApiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
  } catch {
    return buildErrorResult('The email could not be sent because the Resend request failed before a response was returned.');
  }

  if (!response.ok) {
    const responseText = await response.text().catch(() => '');
    const failureDetail = responseText.trim() || `HTTP ${response.status}`;
    return buildErrorResult(`The email could not be sent because Resend returned an error: ${failureDetail}.`);
  }

  const responseBody = (await response.json().catch(() => null)) as { id?: string } | null;

  return {
    content: [
      {
        type: 'text',
        text: `Message sent to Aneesh from ${input.sender_name}.`
      }
    ],
    structuredContent: {
      success: true,
      messageId: responseBody?.id ?? null,
      recipient: appConfig.contact.inboxEmail,
      sender_name: input.sender_name,
      context: input.context ?? null
    }
  };
}

export function registerContactTools(server: McpServer, options: RegisterContactToolsOptions) {
  server.tool(
    'send_message',
    appConfig.tools.sendMessage.description,
    {
      sender_name: z.string().min(1).max(120).describe('Who is reaching out.'),
      message: z.string().min(1).max(1000).describe('The message body, up to 1000 characters.'),
      context: z.string().optional().describe('Optional context for what they want to discuss.'),
      reply_to_email: z
        .string()
        .email()
        .max(320)
        .optional()
        .describe('Optional email to reply to. Provide only if the human explicitly wants a response by email.')
    },
    async ({ sender_name, message, context, reply_to_email }) =>
      sendMessageViaResend(
        {
          sender_name,
          message,
          context,
          reply_to_email
        },
        {
          cacheKv: options.cacheKv,
          resendApiKey: options.resendApiKey,
          request: options.request
        }
      )
  );
}