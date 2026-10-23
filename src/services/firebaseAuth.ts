import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  User,
  signOut,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

const provider = new GoogleAuthProvider();
provider.addScope('https://www.googleapis.com/auth/drive.readonly');
provider.addScope('https://www.googleapis.com/auth/drive.file');

// Flag to indicate if we are in the middle of a sign-in flow.
let isSigningIn = false;
// Cache the access token in memory (never in localStorage/sessionStorage).
let cachedAccessToken: string | null = null;
// Google OAuth 2.0 access tokens expire after 3600s (1 hour). Track expiry with a 5-minute safety margin.
const TOKEN_TTL_MS = 55 * 60 * 1000;
let tokenExpiresAt = 0;
let activeRefreshPromise: Promise<{ user: User; accessToken: string } | null> | null = null;

type TokenChangeListener = (token: string | null, user: User | null) => void;
const tokenListeners = new Set<TokenChangeListener>();

export const onAccessTokenChange = (listener: TokenChangeListener): (() => void) => {
  tokenListeners.add(listener);
  return () => {
    tokenListeners.delete(listener);
  };
};

const notifyTokenListeners = (token: string | null, user: User | null) => {
  tokenListeners.forEach((listener) => {
    try {
      listener(token, user);
    } catch (err) {
      console.warn('Error in token listener:', err);
    }
  });
};

export const getLatestAccessTokenSync = (): string | null => {
  if (!cachedAccessToken) return null;
  if (tokenExpiresAt > 0 && Date.now() > tokenExpiresAt) {
    return null;
  }
  return cachedAccessToken;
};

export const isAccessTokenExpired = (): boolean => {
  if (!cachedAccessToken) return true;
  if (tokenExpiresAt > 0 && Date.now() > tokenExpiresAt) return true;
  return false;
};

export const markAccessTokenInvalid = (): void => {
  cachedAccessToken = null;
  tokenExpiresAt = 0;
};

export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      const validToken = getLatestAccessTokenSync();
      if (validToken) {
        if (onAuthSuccess) onAuthSuccess(user, validToken);
      } else if (!isSigningIn) {
        // Token has not been acquired through popup in this session yet or has expired
        if (onAuthFailure) onAuthFailure();
      }
    } else {
      cachedAccessToken = null;
      tokenExpiresAt = 0;
      if (onAuthFailure) onAuthFailure();
    }
  });
};

export const googleSignIn = async (): Promise<{ user: User; accessToken: string } | null> => {
  if (activeRefreshPromise) {
    return activeRefreshPromise;
  }

  activeRefreshPromise = (async () => {
    try {
      isSigningIn = true;
      const currentEmail = auth.currentUser?.email;
      if (currentEmail) {
        provider.setCustomParameters({ login_hint: currentEmail });
      } else {
        provider.setCustomParameters({ prompt: 'select_account' });
      }

      const result = await signInWithPopup(auth, provider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (!credential?.accessToken) {
        throw new Error('Failed to obtain Google Drive access token');
      }

      cachedAccessToken = credential.accessToken;
      tokenExpiresAt = Date.now() + TOKEN_TTL_MS;
      notifyTokenListeners(cachedAccessToken, result.user);
      return { user: result.user, accessToken: cachedAccessToken };
    } catch (error: any) {
      console.error('Google Sign-in error:', error);
      throw error;
    } finally {
      isSigningIn = false;
      activeRefreshPromise = null;
    }
  })();

  return activeRefreshPromise;
};

export const refreshGoogleAccessToken = async (): Promise<string | null> => {
  const res = await googleSignIn();
  return res?.accessToken ?? null;
};

export const getAccessToken = async (): Promise<string | null> => {
  return getLatestAccessTokenSync();
};

export const logout = async () => {
  await signOut(auth);
  cachedAccessToken = null;
  tokenExpiresAt = 0;
  notifyTokenListeners(null, null);
};

