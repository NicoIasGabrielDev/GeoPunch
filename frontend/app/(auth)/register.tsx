import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../src/contexts/AuthContext';
import { Button } from '../../src/components/Button';
import { Input } from '../../src/components/Input';
import { AccountType } from '../../src/types';
import { getHumanReadableError } from '../../src/utils/network';

export default function RegisterScreen() {
  const [accountType, setAccountType] = useState<AccountType>('personal');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [nif, setNif] = useState('');
  const [loading, setLoading] = useState<'password' | 'google' | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { register, loginWithGoogle } = useAuth();
  const router = useRouter();

  const validate = (requirePassword = true) => {
    const newErrors: Record<string, string> = {};
    if (!name.trim()) newErrors.name = 'Nome obrigatório';
    if (!email) newErrors.email = 'Email obrigatório';
    else if (!/\S+@\S+\.\S+/.test(email)) newErrors.email = 'Email inválido';
    if (requirePassword) {
      if (!password) newErrors.password = 'Senha obrigatória';
      else if (password.length < 6) newErrors.password = 'Mínimo 6 caracteres';
      if (password !== confirmPassword) newErrors.confirmPassword = 'Senhas não coincidem';
    }
    if (accountType === 'enterprise' && !companyName.trim()) {
      newErrors.companyName = 'Nome da empresa obrigatório';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleRegister = async () => {
    if (!validate(true)) return;
    setLoading('password');
    try {
      await register({
        email: email.toLowerCase().trim(),
        password,
        name: name.trim(),
        employeeId: employeeId.trim() || undefined,
        accountType,
        companyName: companyName.trim() || undefined,
        nif: nif.trim() || undefined,
      });
      router.replace('/(tabs)');
    } catch (error: any) {
      Alert.alert('Erro', getHumanReadableError(error, {
        defaultMessage: 'Erro ao registar',
        service: 'supabase',
      }));
    } finally {
      setLoading(null);
    }
  };

  const handleGoogleRegister = async () => {
    if (!validate(false)) return;
    setLoading('google');
    try {
      await loginWithGoogle({
        name: name.trim(),
        employeeId: employeeId.trim() || undefined,
        accountType,
        companyName: companyName.trim() || undefined,
        nif: nif.trim() || undefined,
      });
      router.replace('/(tabs)');
    } catch (error: any) {
      Alert.alert('Erro', error?.message || 'Não foi possível concluir o registo com Google.');
    } finally {
      setLoading(null);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.keyboardView}>
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <View style={styles.iconCircle}>
              <Ionicons name={accountType === 'enterprise' ? 'business' : 'person-add'} size={36} color="#fff" />
            </View>
            <Text style={styles.title}>Criar Conta</Text>
            <Text style={styles.subtitle}>Escolha o tipo de conta e conclua o registo</Text>
          </View>

          <View style={styles.form}>
            <Text style={styles.segmentLabel}>Tipo de conta</Text>
            <View style={styles.segmented}>
              <TouchableOpacity
                style={[styles.segment, accountType === 'personal' && styles.segmentActive]}
                onPress={() => setAccountType('personal')}
              >
                <Text style={[styles.segmentText, accountType === 'personal' && styles.segmentTextActive]}>
                  Conta normal
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.segment, accountType === 'enterprise' && styles.segmentActive]}
                onPress={() => setAccountType('enterprise')}
              >
                <Text style={[styles.segmentText, accountType === 'enterprise' && styles.segmentTextActive]}>
                  Conta empresa
                </Text>
              </TouchableOpacity>
            </View>

            <Input
              label={accountType === 'enterprise' ? 'Nome do Responsável' : 'Nome Completo'}
              placeholder="João Silva"
              value={name}
              onChangeText={setName}
              autoCapitalize="words"
              error={errors.name}
            />

            {accountType === 'enterprise' && (
              <>
                <Input
                  label="Nome da Empresa"
                  placeholder="GeoPunch Construções"
                  value={companyName}
                  onChangeText={setCompanyName}
                  autoCapitalize="words"
                  error={errors.companyName}
                />
                <Input
                  label="NIF (opcional)"
                  placeholder="509999999"
                  value={nif}
                  onChangeText={setNif}
                  keyboardType="numeric"
                />
              </>
            )}

            <Input
              label="Email"
              placeholder="seu@email.com"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              error={errors.email}
            />

            {accountType === 'personal' && (
              <Input
                label="Número de Funcionário (opcional)"
                placeholder="EMP001"
                value={employeeId}
                onChangeText={setEmployeeId}
                autoCapitalize="characters"
              />
            )}

            <Input
              label="Senha"
              placeholder="********"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              error={errors.password}
            />

            <Input
              label="Confirmar Senha"
              placeholder="********"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry
              error={errors.confirmPassword}
            />

            <Button
              title="Registar"
              onPress={handleRegister}
              loading={loading === 'password'}
              style={styles.button}
            />

            <View style={styles.dividerRow}>
              <View style={styles.divider} />
              <Text style={styles.dividerText}>ou</Text>
              <View style={styles.divider} />
            </View>

            <Button
              title="Continuar com Google"
              onPress={handleGoogleRegister}
              loading={loading === 'google'}
              variant="outline"
            />

            <View style={styles.footer}>
              <Text style={styles.footerText}>Já tem conta? </Text>
              <TouchableOpacity onPress={() => router.back()}>
                <Text style={styles.footerLink}>Entrar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  keyboardView: { flex: 1 },
  scrollContent: { flexGrow: 1, padding: 24 },
  header: { alignItems: 'center', marginBottom: 24, marginTop: 20 },
  iconCircle: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: '#1a73e8',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  title: { fontSize: 24, fontWeight: '700', color: '#1a73e8', marginBottom: 4 },
  subtitle: { fontSize: 14, color: '#666', textAlign: 'center' },
  form: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  segmentLabel: { fontSize: 14, fontWeight: '600', color: '#333', marginBottom: 8 },
  segmented: {
    flexDirection: 'row',
    backgroundColor: '#eef2ff',
    borderRadius: 12,
    padding: 4,
    marginBottom: 20,
  },
  segment: { flex: 1, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  segmentActive: { backgroundColor: '#1a73e8' },
  segmentText: { color: '#1f2937', fontSize: 13, fontWeight: '600' },
  segmentTextActive: { color: '#fff' },
  button: { marginTop: 8 },
  dividerRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 16 },
  divider: { flex: 1, height: 1, backgroundColor: '#e5e7eb' },
  dividerText: { marginHorizontal: 12, color: '#666', fontSize: 13 },
  footer: { flexDirection: 'row', justifyContent: 'center', marginTop: 20 },
  footerText: { color: '#666', fontSize: 14 },
  footerLink: { color: '#1a73e8', fontSize: 14, fontWeight: '600' },
});
