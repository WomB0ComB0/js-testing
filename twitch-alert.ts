/**
 * Copyright (c) 2025 Mike Odnis
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import axios from 'axios';
import { TwitterApi } from 'twitter-api-v2';
import { BskyAgent } from '@atproto/api';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Configuration interface for the Twitch Stream Bot
 * @interface Config
 */
interface Config {
  /** Twitch API configuration */
  twitch: {
    /** Twitch application client ID */
    clientId: string;
    /** Twitch application client secret */
    clientSecret: string;
    /** Twitch channel name to monitor (without @ symbol) */
    channelName: string;
  };
  /** Twitter/X API configuration */
  twitter: {
    /** Twitter application key (API key) */
    appKey: string;
    /** Twitter application secret (API secret) */
    appSecret: string;
    /** Twitter access token for the account */
    accessToken: string;
    /** Twitter access token secret */
    accessSecret: string;
  };
  /** Bluesky API configuration */
  bluesky: {
    /** Bluesky handle or email address */
    identifier: string;
    /** Bluesky app password (not account password) */
    password: string;
  };
  /** How often to check stream status in milliseconds (default: 60000 = 1 minute) */
  checkInterval: number;
  /** Template for notification messages. Supports placeholders: {channelName}, {title}, {game}, {viewerCount}, {url} */
  messageTemplate: string;
}

/**
 * Interface representing the current status of a Twitch stream
 * @interface StreamStatus
 */
interface StreamStatus {
  /** Whether the stream is currently live */
  isLive: boolean;
  /** Stream title/description (only present when live) */
  title?: string;
  /** Game/category being played (only present when live) */
  game?: string;
  /** Current number of viewers (only present when live) */
  viewerCount?: number;
  /** URL to stream thumbnail image (only present when live) */
  thumbnailUrl?: string;
}

/**
 * Interface for persistent bot state management
 * @interface BotState
 */
interface BotState {
  /** The last known live status of the stream */
  lastKnownStatus: boolean;
  /** Timestamp of the last notification sent */
  lastNotificationTime: number;
}

/**
 * Main class for the Twitch Stream Notification Bot
 * Monitors a Twitch channel and posts notifications to Twitter and Bluesky when the stream goes live
 * @class TwitchStreamBot
 */
class TwitchStreamBot {
  /** Bot configuration loaded from config file */
  private config: Config;
  /** Current Twitch API access token */
  private twitchAccessToken: string = '';
  /** Twitter API client instance */
  private twitterClient: TwitterApi;
  /** Bluesky API client instance */
  private blueskyAgent: BskyAgent;
  /** Current bot state (live status, last notification time) */
  private state: BotState;
  /** Path to the state file for persistence */
  private stateFile: string;

  /**
   * Creates an instance of TwitchStreamBot
   * @param {string} configPath - Path to the JSON configuration file
   * @throws {Error} Throws an error if the configuration file cannot be loaded
   */
  constructor(configPath: string) {
    this.config = this.loadConfig(configPath);
    this.stateFile = path.join(__dirname, 'bot-state.json');
    this.state = this.loadState();
    
    // Initialize Twitter client
    this.twitterClient = new TwitterApi({
      appKey: this.config.twitter.appKey,
      appSecret: this.config.twitter.appSecret,
      accessToken: this.config.twitter.accessToken,
      accessSecret: this.config.twitter.accessSecret,
    });

    // Initialize Bluesky client
    this.blueskyAgent = new BskyAgent({
      service: 'https://bsky.social',
    });
  }

  /**
   * Loads and validates the configuration file
   * @private
   * @param {string} configPath - Path to the configuration file
   * @returns {Config} Parsed configuration object
   * @throws {Error} Throws an error if the file cannot be read or parsed
   */
  private loadConfig(configPath: string): Config {
    try {
      const configData = fs.readFileSync(configPath, 'utf-8');
      return JSON.parse(configData);
    } catch (error) {
      console.error('Error loading config:', error);
      throw new Error('Failed to load configuration file');
    }
  }

  /**
   * Loads the bot state from the state file, or creates a new state if none exists
   * @private
   * @returns {BotState} Bot state object
   */
  private loadState(): BotState {
    try {
      if (fs.existsSync(this.stateFile)) {
        const stateData = fs.readFileSync(this.stateFile, 'utf-8');
        return JSON.parse(stateData);
      }
    } catch (error) {
      console.log('No existing state file found, creating new state');
    }
    
    return {
      lastKnownStatus: false,
      lastNotificationTime: 0,
    };
  }

  /**
   * Saves the current bot state to the state file
   * @private
   */
  private saveState(): void {
    try {
      fs.writeFileSync(this.stateFile, JSON.stringify(this.state, null, 2));
    } catch (error) {
      console.error('Error saving state:', error);
    }
  }

  /**
   * Obtains an access token from the Twitch API using client credentials flow
   * @private
   * @async
   * @returns {Promise<void>}
   * @throws {Error} Throws an error if the token cannot be obtained
   */
  private async getTwitchAccessToken(): Promise<void> {
    try {
      const response = await axios.post('https://id.twitch.tv/oauth2/token', null, {
        params: {
          client_id: this.config.twitch.clientId,
          client_secret: this.config.twitch.clientSecret,
          grant_type: 'client_credentials',
        },
      });

      this.twitchAccessToken = response.data.access_token;
      console.log('✅ Twitch access token obtained');
    } catch (error) {
      console.error('❌ Error getting Twitch access token:', error);
      throw error;
    }
  }

  /**
   * Checks the current stream status for the configured channel
   * @private
   * @async
   * @returns {Promise<StreamStatus>} Current stream status
   */
  private async getStreamStatus(): Promise<StreamStatus> {
    try {
      if (!this.twitchAccessToken) {
        await this.getTwitchAccessToken();
      }

      const response = await axios.get('https://api.twitch.tv/helix/streams', {
        headers: {
          'Client-ID': this.config.twitch.clientId,
          'Authorization': `Bearer ${this.twitchAccessToken}`,
        },
        params: {
          user_login: this.config.twitch.channelName,
        },
      });

      const streams = response.data.data;
      
      if (streams.length === 0) {
        return { isLive: false };
      }

      const stream = streams[0];
      return {
        isLive: true,
        title: stream.title,
        game: stream.game_name,
        viewerCount: stream.viewer_count,
        thumbnailUrl: stream.thumbnail_url.replace('{width}', '1280').replace('{height}', '720'),
      };
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 401) {
        console.log('🔄 Access token expired, refreshing...');
        await this.getTwitchAccessToken();
        return this.getStreamStatus();
      }
      
      console.error('❌ Error checking stream status:', error);
      return { isLive: false };
    }
  }

  /**
   * Formats a notification message using the template and stream data
   * @private
   * @param {StreamStatus} streamStatus - Current stream status information
   * @returns {string} Formatted notification message
   */
  private formatMessage(streamStatus: StreamStatus): string {
    let message = this.config.messageTemplate;
    
    message = message.replace('{channelName}', this.config.twitch.channelName);
    message = message.replace('{title}', streamStatus.title || 'Live Stream');
    message = message.replace('{game}', streamStatus.game || 'Just Chatting');
    message = message.replace('{viewerCount}', streamStatus.viewerCount?.toString() || '0');
    message = message.replace('{url}', `https://twitch.tv/${this.config.twitch.channelName}`);
    
    return message;
  }

  /**
   * Posts a notification message to Twitter/X
   * @private
   * @async
   * @param {string} message - The message to post
   * @returns {Promise<void>}
   */
  private async postToTwitter(message: string): Promise<void> {
    try {
      await this.twitterClient.v2.tweet(message);
      console.log('✅ Posted to Twitter successfully');
    } catch (error) {
      console.error('❌ Error posting to Twitter:', error);
    }
  }

  /**
   * Posts a notification message to Bluesky
   * @private
   * @async
   * @param {string} message - The message to post
   * @returns {Promise<void>}
   */
  private async postToBluesky(message: string): Promise<void> {
    try {
      if (!this.blueskyAgent.session) {
        await this.blueskyAgent.login({
          identifier: this.config.bluesky.identifier,
          password: this.config.bluesky.password,
        });
      }

      await this.blueskyAgent.post({
        text: message,
        createdAt: new Date().toISOString(),
      });
      
      console.log('✅ Posted to Bluesky successfully');
    } catch (error) {
      console.error('❌ Error posting to Bluesky:', error);
    }
  }

  /**
   * Handles when a stream goes live by posting notifications and updating state
   * @private
   * @async
   * @param {StreamStatus} streamStatus - Current stream status information
   * @returns {Promise<void>}
   */
  private async handleStreamStart(streamStatus: StreamStatus): Promise<void> {
    console.log('🔴 Stream went live! Posting notifications...');
    
    const message = this.formatMessage(streamStatus);
    
    // Post to both platforms simultaneously
    await Promise.allSettled([
      this.postToTwitter(message),
      this.postToBluesky(message),
    ]);

    this.state.lastKnownStatus = true;
    this.state.lastNotificationTime = Date.now();
    this.saveState();
  }

  /**
   * Handles when a stream ends by updating the bot state
   * @private
   * @async
   * @returns {Promise<void>}
   */
  private async handleStreamEnd(): Promise<void> {
    console.log('⚫ Stream ended');
    this.state.lastKnownStatus = false;
    this.saveState();
  }

  /**
   * Main check cycle: gets stream status and handles state transitions
   * @private
   * @async
   * @returns {Promise<void>}
   */
  private async checkAndNotify(): Promise<void> {
    try {
      const streamStatus = await this.getStreamStatus();
      
      // Stream just started
      if (streamStatus.isLive && !this.state.lastKnownStatus) {
        await this.handleStreamStart(streamStatus);
      }
      // Stream just ended
      else if (!streamStatus.isLive && this.state.lastKnownStatus) {
        await this.handleStreamEnd();
      }
      // Stream is live (ongoing)
      else if (streamStatus.isLive) {
        console.log(`📺 Stream is live: "${streamStatus.title}" - ${streamStatus.viewerCount} viewers`);
      }
      // Stream is offline
      else {
        console.log('💤 Stream is offline');
      }
    } catch (error) {
      console.error('❌ Error in check cycle:', error);
    }
  }

  /**
   * Starts the bot: authenticates with services and begins monitoring
   * @public
   * @async
   * @returns {Promise<void>}
   */
  public async start(): Promise<void> {
    console.log('🚀 Starting Twitch Stream Notification Bot...');
    console.log(`📺 Monitoring channel: ${this.config.twitch.channelName}`);
    console.log(`⏱️  Check interval: ${this.config.checkInterval / 1000} seconds`);
    
    // Initial authentication
    try {
      await this.getTwitchAccessToken();
      await this.blueskyAgent.login({
        identifier: this.config.bluesky.identifier,
        password: this.config.bluesky.password,
      });
      console.log('✅ Authenticated with all services');
    } catch (error) {
      console.error('❌ Failed to authenticate with services:', error);
      return;
    }

    // Initial check
    await this.checkAndNotify();

    // Set up periodic checks
    setInterval(() => {
      this.checkAndNotify();
    }, this.config.checkInterval);

    console.log('✅ Bot is running! Press Ctrl+C to stop.');
  }

  /**
   * Gracefully stops the bot and saves current state
   * @public
   * @returns {void}
   */
  public stop(): void {
    console.log('🛑 Stopping bot...');
    this.saveState();
    process.exit(0);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Received SIGINT, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
  process.exit(0);
});

/**
 * Main application entry point
 * Creates and starts a new TwitchStreamBot instance
 * @async
 * @returns {Promise<void>}
 */
async function main() {
  const configPath = process.argv[2] || './config.json';
  
  try {
    const bot = new TwitchStreamBot(configPath);
    await bot.start();
  } catch (error) {
    console.error('❌ Failed to start bot:', error);
    process.exit(1);
  }
}

// Run the bot
if (require.main === module) { main().catch(console.eror); }

export { TwitchStreamBot };
