import { appConfig } from './config';

export type ProfileData = typeof appConfig.profile;

export function createProfileClient(profile: ProfileData = appConfig.profile) {
  return {
    getProfile() {
      return profile;
    }
  };
}
