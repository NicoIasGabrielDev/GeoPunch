import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { authApi, setToken, removeToken, getToken, setRefreshToken, seedData } from '../services/api';
import { User } from '../types';

interface AuthContextType {
  user: User | null;
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
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      const token = await getToken();
      if (token) {
        const response = await authApi.getMe();
        setUser(response.data);
      }
    } catch {
      console.log('Not authenticated');
      await removeToken();
    } finally {
      setIsLoading(false);
    }
  };

  const login = async (email: string, password: string) => {
    const response = await authApi.login({ email, password });
    await setToken(response.data.access_token);
    if (response.data.refresh_token) {
      await setRefreshToken(response.data.refresh_token);
    }
    setUser(response.data.user);
  };

  const register = async (email: string, password: string, name: string, employeeId?: string) => {
    // First try to seed data (creates admin and sample workplace)
    try {
      await seedData();
    } catch {
      // Ignore if already seeded
    }
    
    const response = await authApi.register({ email, password, name, employeeId });
    await setToken(response.data.access_token);
    if (response.data.refresh_token) {
      await setRefreshToken(response.data.refresh_token);
    }
    setUser(response.data.user);
  };

  const logout = async () => {
    await removeToken();
    setUser(null);
  };

  const refreshUser = async () => {
    try {
      const response = await authApi.getMe();
      setUser(response.data);
    } catch (error) {
      console.error('Error refreshing user:', error);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
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
