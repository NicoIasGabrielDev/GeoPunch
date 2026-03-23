/**
 * Supabase Profile Service
 * Manages user profiles directly in Supabase database
 * This service handles the synchronization between auth.users and public.profiles
 */

import { supabase } from '../config/supabase';
import { User } from '../types';

export interface ProfileData {
  id: string;
  email: string;
  name: string;
  employee_id?: string;
  role: string;
  active_workplace_id?: string;
  created_at: string;
  updated_at: string;
}

export const supabaseProfileService = {
  /**
   * Get current user profile from Supabase
   * This reads from the public.profiles table
   */
  getProfile: async (): Promise<User | null> => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        return null;
      }

      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

      if (error) {
        console.error('❌ Error fetching profile:', error);
        
        if (error.code === 'PGRST116') {
          return await supabaseProfileService.createProfileFromAuth(user);
        }
        
        throw error;
      }

      return {
        id: data.id,
        email: data.email,
        name: data.name,
        employeeId: data.employee_id,
        role: data.role,
        activeWorkplaceId: data.active_workplace_id,
        createdAt: data.created_at,
      };
    } catch (error) {
      console.error('❌ Error in getProfile:', error);
      throw error;
    }
  },

  /**
   * Create a new profile in Supabase
   * This is called during registration or when a profile is missing
   */
  createProfile: async (data: {
    id: string;
    email: string;
    name: string;
    employee_id?: string;
    role?: string;
  }): Promise<User> => {
    try {
      const profileData = {
        id: data.id,
        email: data.email,
        name: data.name,
        employee_id: data.employee_id,
        role: data.role || 'employee',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const { data: profile, error } = await supabase
        .from('profiles')
        .insert(profileData)
        .select()
        .single();

      if (error) {
        console.error('❌ Error creating profile:', error);
        throw error;
      }

      return {
        id: profile.id,
        email: profile.email,
        name: profile.name,
        employeeId: profile.employee_id,
        role: profile.role,
        activeWorkplaceId: profile.active_workplace_id,
        createdAt: profile.created_at,
      };
    } catch (error) {
      console.error('❌ Error in createProfile:', error);
      throw error;
    }
  },

  /**
   * Create profile from auth user metadata
   * Used as fallback when profile doesn't exist
   */
  createProfileFromAuth: async (authUser: any): Promise<User> => {
    const metadata = authUser.user_metadata || {};
    
    return await supabaseProfileService.createProfile({
      id: authUser.id,
      email: authUser.email!,
      name: metadata.name || authUser.email!.split('@')[0],
      employee_id: metadata.employee_id,
      role: metadata.role || 'employee',
    });
  },

  /**
   * Update user profile
   */
  updateProfile: async (updates: {
    name?: string;
    employee_id?: string;
    role?: string;
    active_workplace_id?: string;
  }): Promise<User> => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        throw new Error('No authenticated user');
      }

      const updateData = {
        ...updates,
        updated_at: new Date().toISOString(),
      };

      const { data, error } = await supabase
        .from('profiles')
        .update(updateData)
        .eq('id', user.id)
        .select()
        .single();

      if (error) {
        console.error('❌ Error updating profile:', error);
        throw error;
      }

      return {
        id: data.id,
        email: data.email,
        name: data.name,
        employeeId: data.employee_id,
        role: data.role,
        activeWorkplaceId: data.active_workplace_id,
        createdAt: data.created_at,
      };
    } catch (error) {
      console.error('❌ Error in updateProfile:', error);
      throw error;
    }
  },

  /**
   * Set active workplace for user
   */
  setActiveWorkplace: async (workplaceId: string | null): Promise<void> => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        throw new Error('No authenticated user');
      }

      const { error } = await supabase
        .from('profiles')
        .update({ 
          active_workplace_id: workplaceId,
          updated_at: new Date().toISOString(),
        })
        .eq('id', user.id);

      if (error) {
        console.error('❌ Error setting active workplace:', error);
        throw error;
      }
    } catch (error) {
      console.error('❌ Error in setActiveWorkplace:', error);
      throw error;
    }
  },
};
