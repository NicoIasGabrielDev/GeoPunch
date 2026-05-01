import React, { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import { Session } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { clearStoredTokens, storeSessionTokens, supabase } from '../config/supabase';
import { isScreenshotSeedEnabled } from '../config/appMode';
import { screenshotSeedService } from '../demo/screenshotSeed';
import { supabaseProfileService } from '../services/supabaseProfile';
import { enterpriseService } from '../services/backend';
import { User, AccountType } from '../types';

WebBrowser.maybeCompleteAuthSession();

export interface RegisterOptions {
  email: string;
  password?: string;
  name: string;
  employeeId?: string;
  accountType: AccountType;
  companyName?: string;
  nif?: string;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  loginWithGoogle: (options?: Partial<RegisterOptions>) => Promise<void>;
  register: (options: RegisterOptions) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const parseAuthTokensFromUrl = (url: string) => {
  const [, hashPart = ''] = url.split('#');
  const queryPart = url.includes('?') ? url.split('?')[1]?.split('#')[0] ?? '' : '';
  const params = new URLSearchParams(hashPart || queryPart);
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  return { accessToken, refreshToken };
};

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const loggingOut = useRef(false);
  const activeLoginRef = useRef(false);

  const fetchUserProfile = useCallback(async () => {
    try {
      const userData = await supabaseProfileService.getProfile();
      if (!userData) {
        setUser(null);
        return null;
      }

      if (userData.enterpriseId) {
        try {
          const enterprise = await enterpriseService.getCurrent();
          const enrichedUser = {
            ...userData,
            enterpriseName: enterprise?.name ?? userData.enterpriseName ?? null,
          };
          setUser(enrichedUser);
          return enrichedUser;
        } catch (error) {
          console.error('❌ Error fetching enterprise summary:', error);
        }
      }

      setUser(userData);
      return userData;
    } catch (error) {
      console.error('❌ Error fetching user profile:', error);
      setUser(null);
      return null;
    }
  }, []);

  const applyPostRegistrationSetup = useCallback(async (options?: Partial<RegisterOptions>) => {
    if (!options) {
      await fetchUserProfile();
      return;
    }

    const accountType = options.accountType ?? 'personal';
    const currentProfile = await fetchUserProfile();

    if (accountType === 'enterprise') {
      await supabaseProfileService.updateProfile({
        name: options.name?.trim(),
        employee_id: options.employeeId?.trim() || undefined,
        role: 'enterprise_owner',
        account_type: 'enterprise',
      });

      if (options.companyName?.trim()) {
        await enterpriseService.bootstrap({
          name: options.companyName.trim(),
          nif: options.nif?.trim() || undefined,
        });
      }
    } else if (currentProfile) {
      await supabaseProfileService.updateProfile({
        name: options.name?.trim() || currentProfile.name,
        employee_id: options.employeeId?.trim() || undefined,
        role: currentProfile.enterpriseId ? 'employee' : 'personal_user',
        account_type: 'personal',
      });
    }

    await fetchUserProfile();
  }, [fetchUserProfile]);

  const createSessionFromUrl = useCallback(async (url: string, options?: Partial<RegisterOptions>) => {
    const { accessToken, refreshToken } = parseAuthTokensFromUrl(url);
    if (!accessToken || !refreshToken) return null;

    const { data, error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });

    if (error || !data.session) {
      throw error ?? new Error('Não foi possível concluir o login com Google.');
    }

    setSession(data.session);
    await storeSessionTokens(data.session);
    await applyPostRegistrationSetup(options);
    return data.session;
  }, [applyPostRegistrationSetup]);

  const checkAuth = useCallback(async () => {
    if (isScreenshotSeedEnabled) {
      setUser(screenshotSeedService.getCurrentUser());
      setSession(null);
      setIsLoading(false);
      return;
    }

    try {
      const { data: { session: currentSession } } = await supabase.auth.getSession();
      if (!currentSession) {
        setSession(null);
        setUser(null);
        await clearStoredTokens();
        setIsLoading(false);
        return;
      }

      const expiresAt = currentSession.expires_at ?? 0;
      const nowInSeconds = Math.floor(Date.now() / 1000);
      if (expiresAt - nowInSeconds < 60) {
        const { data, error } = await supabase.auth.refreshSession();
        if (error || !data.session) {
          setSession(null);
          setUser(null);
          await clearStoredTokens();
          setIsLoading(false);
          return;
        }
        setSession(data.session);
        await storeSessionTokens(data.session);
      } else {
        setSession(currentSession);
        await storeSessionTokens(currentSession);
      }

      setIsLoading(false);
      void fetchUserProfile();
    } catch (error) {
      console.error('Error checking auth:', error);
      setSession(null);
      setUser(null);
      await clearStoredTokens();
      setIsLoading(false);
    }
  }, [fetchUserProfile]);

  useEffect(() => {
    if (isScreenshotSeedEnabled) {
      void checkAuth();
      return;
    }

    void checkAuth();

    const subscription = supabase.auth.onAuthStateChange(async (event, newSession) => {
      if (loggingOut.current || activeLoginRef.current) return;

      if (event === 'SIGNED_OUT' || !newSession) {
        setSession(null);
        setUser(null);
        await clearStoredTokens();
        return;
      }

      setSession(newSession);
      await storeSessionTokens(newSession);
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        await fetchUserProfile();
      }
    });

    const handleIncomingUrl = async ({ url }: { url: string }) => {
      try {
        await createSessionFromUrl(url);
      } catch (error) {
        console.error('OAuth deep link error:', error);
      }
    };

    const urlSubscription = Linking.addEventListener('url', handleIncomingUrl);

    return () => {
      subscription.data.subscription.unsubscribe();
      urlSubscription.remove();
    };
  }, [checkAuth, createSessionFromUrl, fetchUserProfile]);

  const login = async (email: string, password: string) => {
    if (isScreenshotSeedEnabled) {
      void password;
      setUser(await screenshotSeedService.login(email));
      setSession(null);
      setIsLoading(false);
      return;
    }

    activeLoginRef.current = true;
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;

      setSession(data.session);
      await storeSessionTokens(data.session);
      await fetchUserProfile();
    } finally {
      activeLoginRef.current = false;
    }
  };

  const loginWithGoogle = async (options?: Partial<RegisterOptions>) => {
    activeLoginRef.current = true;
    try {
      const redirectTo = Linking.createURL('auth/callback');
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo,
          skipBrowserRedirect: true,
          queryParams: {
            prompt: 'select_account',
          },
        },
      });

      if (error || !data?.url) {
        throw error ?? new Error('Não foi possível iniciar o login com Google.');
      }

      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
      if (result.type !== 'success') {
        throw new Error('Login com Google cancelado.');
      }

      await createSessionFromUrl(result.url, options);
    } finally {
      activeLoginRef.current = false;
    }
  };

  const register = async (options: RegisterOptions) => {
    if (isScreenshotSeedEnabled) {
      setUser(await screenshotSeedService.register(options.email, options.name, options.employeeId));
      setSession(null);
      setIsLoading(false);
      return;
    }

    activeLoginRef.current = true;
    try {
      const { data, error } = await supabase.auth.signUp({
        email: options.email,
        password: options.password!,
        options: {
          data: {
            name: options.name,
            employee_id: options.employeeId,
            account_type: options.accountType,
          },
        },
      });

      if (error) throw error;

      if (data.session && data.user) {
        setSession(data.session);
        await storeSessionTokens(data.session);
        await new Promise((resolve) => setTimeout(resolve, 1000));
        await applyPostRegistrationSetup(options);
      } else {
        throw new Error('Registo criado. Verifique o email para confirmar a conta.');
      }
    } finally {
      activeLoginRef.current = false;
    }
  };

  const logout = async () => {
    if (isScreenshotSeedEnabled) {
      await screenshotSeedService.logout();
      setSession(null);
      setUser(null);
      setIsLoading(false);
      return;
    }

    loggingOut.current = true;
    setSession(null);
    setUser(null);
    setIsLoading(false);

    try {
      await clearStoredTokens();
      await supabase.auth.signOut({ scope: 'local' });

      const storageKey = `sb-${new URL(process.env.EXPO_PUBLIC_SUPABASE_URL!).hostname.split('.')[0]}-auth-token`;
      if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
        localStorage.removeItem(storageKey);
      } else {
        await Promise.allSettled([
          SecureStore.deleteItemAsync(storageKey),
          AsyncStorage.removeItem(storageKey),
        ]);
      }
    } catch (error) {
      console.error('Logout error (ignored):', error);
    } finally {
      loggingOut.current = false;
    }
  };

  const refreshUser = async () => {
    if (isScreenshotSeedEnabled) {
      setUser(screenshotSeedService.getCurrentUser());
      return;
    }
    await fetchUserProfile();
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        isLoading,
        isAuthenticated: isScreenshotSeedEnabled ? !!user : !!session,
        login,
        loginWithGoogle,
        register,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
