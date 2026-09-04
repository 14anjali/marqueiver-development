import crypto from 'node:crypto';
import { env } from '../config/env.js';

const GRAPH_VERSION = env.facebook.graphVersion || 'v23.0';
const GRAPH_URL = `https://graph.facebook.com/${GRAPH_VERSION}`;

/**
 * Generate a random OAuth state nonce.
 */
export function newState() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Build Facebook OAuth URL.
 *
 * Only request permissions needed for basic Facebook login.
 */
export function buildAuthUrl(state) {
  const params = new URLSearchParams({
    client_id: env.facebook.appId,
    redirect_uri: env.facebook.redirectUri,
    state,
    response_type: 'code',
    scope: ['public_profile', 'email'].join(','),
  });

  return `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth?${params.toString()}`;
}

/**
 * Exchange Facebook authorization code for a user access token.
 */
export async function exchangeCodeForToken(code) {
  const params = new URLSearchParams({
    client_id: env.facebook.appId,
    client_secret: env.facebook.appSecret,
    redirect_uri: env.facebook.redirectUri,
    code,
  });

  const response = await fetch(
    `${GRAPH_URL}/oauth/access_token?${params.toString()}`
  );

  const data = await response.json();

  if (!response.ok || data.error) {
    const message =
      data.error?.message ||
      'Unable to exchange Facebook authorization code';

    if (data.error?.code === 100 && /used/i.test(message)) {
      const err = new Error('FB_CODE_ALREADY_USED');
      err.code = 'FB_CODE_ALREADY_USED';
      throw err;
    }

    const err = new Error(message);
    err.code = data.error?.code;
    throw err;
  }

  return {
    access_token: data.access_token,
    token_type: data.token_type || 'bearer',
    expires_in: data.expires_in,
    scopes: [],
  };
}

/**
 * Fetch Facebook user profile.
 */
export async function fetchUserProfile(userAccessToken) {
  const fields = [
    'id',
    'name',
    'email',
    'picture.type(large)',
  ].join(',');

  const params = new URLSearchParams({
    fields,
    access_token: userAccessToken,
  });

  const response = await fetch(`${GRAPH_URL}/me?${params.toString()}`);
  const data = await response.json();

  if (!response.ok || data.error) {
    throw new Error(
      data.error?.message || 'Unable to fetch Facebook User Profile'
    );
  }

  return {
    id: data.id,
    name: data.name,
    email: data.email || null,
    profilePicture: data.picture?.data?.url || null,
  };
}

/**
 * Retain fetchManagedPages for backward compatibility.
 */
export async function fetchManagedPages(userAccessToken) {
  return [];
}