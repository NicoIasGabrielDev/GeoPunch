import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { Session } from '@supabase/supabase-js';
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

  const fetchUserProfile = useCallback(async () => {
    try {
      const userData = await supabaseProfileService.getProfile();
      setUser(userData);
    } catch (error: any) {
      console.error('❌ Error fetching user profile:', error);
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
        await storeSessionTokens(data.session);
      } else {
        setSession(session);
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
  }, [fetchUserProfile]);

  useEffect(() => {
    // Check for existing session on mount
    checkAuth();

    // Listen for auth state changes
    const { data: authListener } = supabase.auth.onAuthStateChange(async (event, session) => {
      setSession(session);

      if (event === 'SIGNED_OUT' || !session) {
        await clearStoredTokens();
        setUser(null);
      } else if (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') {
        await storeSessionTokens(session);
        await fetchUserProfile();
      } else if (session) {
        await storeSessionTokens(session);
        await fetchUserProfile();
      }
    });

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, [checkAuth, fetchUserProfile]);

  const login = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      console.error('❌ Supabase login error:', error);
      throw error;
    }

    setSession(data.session);
    await storeSessionTokens(data.session);
    
    if (data.session) {
      await fetchUserProfile();
    }
  };

  const register = async (email: string, password: string, name: string, employeeId?: string) => {
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

    if (data.session && data.user) {
      setSession(data.session);
      await storeSessionTokens(data.session);
      
      try {
        // Small delay to ensure trigger completes
        await new Promise(resolve => setTimeout(resolve, 500));
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
  };

  const logout = async () => {
    await supabase.auth.signOut();
    await clearStoredTokens();
    setSession(null);
    setUser(null);
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
