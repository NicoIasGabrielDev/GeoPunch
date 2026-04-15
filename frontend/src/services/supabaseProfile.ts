import { supabase } from '../config/supabase';
import { User } from '../types';

export interface ProfileData {
  id: string;
  email: string;
  name: string;
  employee_id?: string;
  role: string;
  account_type: string;
  enterprise_id?: string | null;
  active_workplace_id?: string | null;
  created_at: string;
  updated_at: string;
}

const mapProfileToUser = (data: ProfileData): User => ({
  id: data.id,
  email: data.email,
  name: data.name,
  employeeId: data.employee_id,
  role: data.role as User['role'],
  accountType: (data.account_type || 'personal') as User['accountType'],
  enterpriseId: data.enterprise_id,
  activeWorkplaceId: data.active_workplace_id,
  createdAt: data.created_at,
});

export const supabaseProfileService = {
  getProfile: async (): Promise<User | null> => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;

      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return await supabaseProfileService.createProfileFromAuth(user);
        }
        throw error;
      }

      return mapProfileToUser(data as ProfileData);
    } catch (error) {
      console.error('❌ Error in getProfile:', error);
      throw error;
    }
  },

  createProfile: async (data: {
    id: string;
    email: string;
    name: string;
    employee_id?: string;
    role?: string;
    account_type?: string;
  }): Promise<User> => {
    try {
      const profileData = {
        id: data.id,
        email: data.email,
        name: data.name,
        employee_id: data.employee_id,
        role: data.role || 'personal_user',
        account_type: data.account_type || 'personal',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const { data: profile, error } = await supabase
        .from('profiles')
        .insert(profileData)
        .select()
        .single();

      if (error) throw error;
      return mapProfileToUser(profile as ProfileData);
    } catch (error) {
      console.error('❌ Error in createProfile:', error);
      throw error;
    }
  },

  createProfileFromAuth: async (authUser: any): Promise<User> => {
    const metadata = authUser.user_metadata || {};
    const accountType = metadata.account_type === 'enterprise' ? 'enterprise' : 'personal';

    return await supabaseProfileService.createProfile({
      id: authUser.id,
      email: authUser.email!,
      name: metadata.name || authUser.email!.split('@')[0],
      employee_id: metadata.employee_id,
      role: accountType === 'enterprise' ? 'enterprise_owner' : 'personal_user',
      account_type: accountType,
    });
  },

  updateProfile: async (updates: {
    name?: string;
    employee_id?: string;
    role?: string;
    account_type?: string;
    enterprise_id?: string | null;
    active_workplace_id?: string | null;
  }): Promise<User> => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('No authenticated user');

      const { data, error } = await supabase
        .from('profiles')
        .update({
          ...updates,
          updated_at: new Date().toISOString(),
        })
        .eq('id', user.id)
        .select()
        .single();

      if (error) throw error;
      return mapProfileToUser(data as ProfileData);
    } catch (error) {
      console.error('❌ Error in updateProfile:', error);
      throw error;
    }
  },

  setActiveWorkplace: async (workplaceId: string | null): Promise<void> => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('No authenticated user');

      const { error } = await supabase
        .from('profiles')
        .update({
          active_workplace_id: workplaceId,
          updated_at: new Date().toISOString(),
        })
        .eq('id', user.id);

      if (error) throw error;
    } catch (error) {
      console.error('❌ Error in setActiveWorkplace:', error);
      throw error;
    }
  },
};
