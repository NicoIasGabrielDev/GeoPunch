import React, { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import { Session } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { clearStoredTokens, storeSessionTokens, supabase } from '../config/supabase';
import { supabaseProfileService } from '../services/supabaseProfile';
import { User } from '../types';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string, employeeId?: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const loggingOut = useRef(false);
  const activeLoginRef = useRef(false);

  const logSupabaseToken = useCallback((source: string, currentSession: Session | null) => {
    if (!currentSession) {
      console.log(`[AUTH][${source}] No session/token returned by Supabase`);
      return;
    }

    console.log(`[AUTH][${source}] access_token:`, currentSession.access_token ?? null);
    console.log(`[AUTH][${source}] refresh_token:`, currentSession.refresh_token ?? null);
    console.log(`[AUTH][${source}] expires_at:`, currentSession.expires_at ?? null);
  }, []);

  const fetchUserProfile = useCallback(async () => {
    try {
      const userData = await supabaseProfileService.getProfile();
      if (!userData) {
        console.warn('No user profile found');
        // Don't force logout during active login/register — profile may not exist yet
        if (!activeLoginRef.current) {
          setUser(null);
        }
        return;
      }
      setUser(userData);
    } catch (error: any) {
      console.error('❌ Error fetching user profile:', error);
      // Don't force logout — the session is valid even if the profile fetch fails
      // (e.g., network issue, backend cold start, Supabase latency)
      setUser(null);
    }
  }, []);

  const checkAuth = useCallback(async () => {
    try {
      // getSession() reads from local storage (fast, no network call)
      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        setSession(null);
        setUser(null);
        await clearStoredTokens();
        setIsLoading(false);
        return;
      }

      // Check if token is expired or about to expire (within 60s)
      const expiresAt = session.expires_at ?? 0;
      const nowInSeconds = Math.floor(Date.now() / 1000);
      if (expiresAt - nowInSeconds < 60) {
        // Token expired - try refresh (network call)
        const { data, error } = await supabase.auth.refreshSession();
        if (error || !data.session) {
          // Refresh token also expired - force login
          setSession(null);
          setUser(null);
          await clearStoredTokens();
          setIsLoading(false);
          return;
        }
        setSession(data.session);
        logSupabaseToken('checkAuth.refreshSession', data.session);
        await storeSessionTokens(data.session);
      } else {
        setSession(session);
        logSupabaseToken('checkAuth.getSession', session);
        await storeSessionTokens(session);
      }

      // Unblock loading BEFORE the backend profile fetch
      // Prevents infinite splash when Render has cold-start delay
      setIsLoading(false);
      fetchUserProfile(); // fire-and-forget, UI updates when it resolves
    } catch (error) {
      console.error('Error checking auth:', error);
      setSession(null);
      setUser(null);
      await clearStoredTokens();
      setIsLoading(false);
    }
  }, [fetchUserProfile, logSupabaseToken]);

  useEffect(() => {
    // Check for existing session on mount
    checkAuth();

    // Listen for auth state changes
    const { data: authListener } = supabase.auth.onAuthStateChange(async (event, newSession) => {
      // If we're in the middle of logging out or actively logging in, ignore events
      if (loggingOut.current || activeLoginRef.current) {
        return;
      }

      if (event === 'SIGNED_OUT' || !newSession) {
        setSession(null);
        setUser(null);
        await clearStoredTokens();
      } else if (event === 'TOKEN_REFRESHED') {
        setSession(newSession);
        logSupabaseToken('onAuthStateChange.TOKEN_REFRESHED', newSession);
        await storeSessionTokens(newSession);
      } else if (event === 'SIGNED_IN') {
        setSession(newSession);
        logSupabaseToken('onAuthStateChange.SIGNED_IN', newSession);
        await storeSessionTokens(newSession);
        await fetchUserProfile();
      } else if (newSession) {
        setSession(newSession);
        logSupabaseToken(`onAuthStateChange.${event}`, newSession);
        await storeSessionTokens(newSession);
      }
    });

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, [checkAuth, fetchUserProfile, logSupabaseToken]);

  const login = async (email: string, password: string) => {
    activeLoginRef.current = true;
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        console.error('❌ Supabase login error:', error);
        throw error;
      }

      setSession(data.session);
      logSupabaseToken('login.signInWithPassword', data.session);
      await storeSessionTokens(data.session);
      
      if (data.session) {
        await fetchUserProfile();
      }
    } finally {
      activeLoginRef.current = false;
    }
  };

  const register = async (email: string, password: string, name: string, employeeId?: string) => {
    activeLoginRef.current = true;
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            name,
            employee_id: employeeId,
          },
        },
      });

      if (error) {
        console.error('❌ Supabase signup error:', error);
        throw error;
      }

      logSupabaseToken('register.signUp', data.session);

      if (data.session && data.user) {
        setSession(data.session);
        await storeSessionTokens(data.session);
        
        try {
          // Small delay to ensure trigger completes
          await new Promise(resolve => setTimeout(resolve, 1000));
          await fetchUserProfile();
        } catch (profileError: any) {
          console.error('❌ Error fetching profile after registration:', profileError);
          
          // Fallback: manually create profile if trigger failed
          try {
            const profile = await supabaseProfileService.createProfile({
              id: data.user.id,
              email,
              name,
              employee_id: employeeId,
            });
            setUser(profile);
          } catch (createError: any) {
            // If profile already exists (from trigger), fetch it
            if (createError.code === '23505') {
              await fetchUserProfile();
            } else {
              throw new Error('Erro ao criar perfil: ' + (createError.message || 'Erro desconhecido'));
            }
          }
        }
      } else {
        // Email confirmation required
        throw new Error('Registro criado! Verifique seu email para confirmar a conta antes de fazer login.');
      }
    } finally {
      activeLoginRef.current = false;
    }
  };

  const logout = async () => {
    // Set flag to prevent onAuthStateChange from re-setting session
    loggingOut.current = true;

    // Immediately clear React state — this makes isAuthenticated false
    setSession(null);
    setUser(null);
    setIsLoading(false);

    // Clear persisted tokens
    try {
      await clearStoredTokens();
    } catch (e) {
      console.error('Error clearing tokens (ignored):', e);
    }

    // Tell Supabase SDK to clear its internal session cache
    try {
      await supabase.auth.signOut({ scope: 'local' });
    } catch (e) {
      console.error('Error during signOut (ignored):', e);
    }

    // Also manually remove the Supabase SDK's own storage keys
    try {
      const storageKey = `sb-${new URL(process.env.EXPO_PUBLIC_SUPABASE_URL!).hostname.split('.')[0]}-auth-token`;
      if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
        localStorage.removeItem(storageKey);
      } else {
        await SecureStore.deleteItemAsync(storageKey);
      }
    } catch (e) {
      // Key might not exist or format might differ, that's ok
      void e;
    }

    loggingOut.current = false;
  };

  const refreshUser = async () => {
    await fetchUserProfile();
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        isLoading,
        isAuthenticated: !!session,
        login,
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
