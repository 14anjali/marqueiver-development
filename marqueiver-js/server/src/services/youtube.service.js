import crypto from 'node:crypto';
import { env } from '../config/env.js';

const YOUTUBE_API_URL = 'https://www.googleapis.com/youtube/v3';
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

export function newState() {
  return crypto.randomBytes(32).toString('hex');
}

export function buildAuthUrl(state) {
  const params = new URLSearchParams({
    client_id: env.google.clientId,
    redirect_uri: env.google.redirectUri,
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    state,
    scope: [
      'openid',
      'email',
      'profile',
      'https://www.googleapis.com/auth/youtube.readonly',
    ].join(' '),
  });

  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}


export async function exchangeCodeForToken(code) {
  const params = new URLSearchParams({
    client_id: env.google.clientId,
    client_secret: env.google.clientSecret,
    redirect_uri: env.google.redirectUri,
    grant_type: 'authorization_code',
    code,
  });

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params,
  });

  const data = await response.json();

  if (!response.ok || data.error) {
    const error = new Error(
      data.error_description ||
      data.error ||
      'Unable to exchange YouTube authorization code',
    );

    error.status = response.status;
    throw error;
  }

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token || null,
    tokenType: data.token_type || 'Bearer',
    expires_in: data.expires_in || 3600,
    scopes: data.scope ? data.scope.split(' ') : [],
    token_type: data.token_type || 'Bearer',
    scope: data.scope || '',
  };
}


async function youtubeRequest(endpoint, params = {}, accessToken) {
  const query = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      query.set(key, String(value));
    }
  });

  const headers = {};

  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  } else if (env.youtubeApiKey) {
    query.set('key', env.youtubeApiKey);
  }

  const response = await fetch(
    `${YOUTUBE_API_URL}/${endpoint}?${query.toString()}`,
    {
      method: 'GET',
      headers,
    },
  );

  const data = await response.json();

  if (!response.ok || data.error) {
    const error = new Error(
      data.error?.message || 'Unable to fetch data from YouTube API',
    );

    error.status = response.status;
    throw error;
  }

  return data;
}

/**
 * Controller-compatible profile method.
 *
 * Controller calls:
 * fetchProfile(accessToken, 'mine')
 * fetchProfile(accessToken, channelId)
 */
export async function fetchProfile(accessToken, channelId = 'mine') {
  if (!accessToken) {
    throw new Error('YouTube access token is required');
  }

  if (!channelId || channelId === 'mine') {
    return fetchMyChannelProfile(accessToken);
  }

  return fetchChannelProfile(channelId, accessToken);
}

export async function fetchMyChannelProfile(accessToken) {
  const data = await youtubeRequest(
    'channels',
    {
      part: 'snippet,statistics,brandingSettings,contentDetails',
      mine: 'true',
    },
    accessToken,
  );

  if (!data.items?.length) {
    throw new Error('No YouTube channel found for this account');
  }

  return normalizeChannel(data.items[0]);
}

export async function fetchChannelProfile(channelId, accessToken = null) {
  if (!channelId) {
    throw new Error('YouTube channel ID is required');
  }

  const data = await youtubeRequest(
    'channels',
    {
      part: 'snippet,statistics,brandingSettings,contentDetails',
      id: channelId,
    },
    accessToken,
  );

  if (!data.items?.length) {
    throw new Error('YouTube channel not found');
  }

  return normalizeChannel(data.items[0]);
}

/**
 * Shape required by persistProfile() in the controller.
 */
function normalizeChannel(channel) {
  const snippet = channel.snippet || {};
  const statistics = channel.statistics || {};

  return {
    id: channel.id,

    title: snippet.title || '',
    description: snippet.description || '',
    customUrl: snippet.customUrl || null,
    publishedAt: snippet.publishedAt || null,

    thumbnails: snippet.thumbnails || {},

    statistics: {
      viewCount: statistics.viewCount || '0',
      subscriberCount: statistics.subscriberCount || '0',
      videoCount: statistics.videoCount || '0',
    },

    // Backward-compatible aliases for other service methods
    name: snippet.title || null,

    profilePicture:
      snippet.thumbnails?.high?.url ||
      snippet.thumbnails?.medium?.url ||
      snippet.thumbnails?.default?.url ||
      null,

    bannerImage:
      channel.brandingSettings?.image?.bannerExternalUrl || null,

    country: snippet.country || null,

    subscribersCount: Number(statistics.subscriberCount || 0),
    videoCount: Number(statistics.videoCount || 0),
    viewsCount: Number(statistics.viewCount || 0),

    uploadsPlaylistId:
      channel.contentDetails?.relatedPlaylists?.uploads || null,

    url: `https://www.youtube.com/channel/${channel.id}`,
  };
}