/**
 * Copy this file's contents to a new config.ts file
 */

/**
 * Fill in values from an app on Discord's dev portal here:
 * https://discordapp.com/developers/applications/me
 */
export const auth = {
  clientID: '99999999999',
  token: 'xxxxxxxxxxxxxx',
};

/**
 * Settings for self-serve voice feature. Turn on developer mode in discord to get these IDs (under appearance)
 */
export const selfServeVoice = {
  /**
   * Name of category within which self-serve voice channels will be created (not-case sensitive)
   */
  categoryName: 'on-demand voice',
  /**
   * Name of text channel to respond to commands in (will search the above category before others)
   */
  commandChannelName: 'requests',
  /**
   * Length of time in seconds that an unused voice channel will exist
   */
  cleanupWindow: 3600 * 48,
  /**
   * Length of time in seconds that a newly created voice channel will exist
   * before it is used for the first time
   */
  firstJoinWindow: 60,
};
