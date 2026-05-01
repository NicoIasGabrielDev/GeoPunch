import React from 'react';
import { View, Text, TextInput, StyleSheet, ViewStyle } from 'react-native';

interface InputProps {
  label?: string;
  placeholder?: string;
  value: string;
  onChangeText: (text: string) => void;
  secureTextEntry?: boolean;
  keyboardType?: 'default' | 'email-address' | 'numeric' | 'phone-pad';
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  error?: string;
  style?: ViewStyle;
  multiline?: boolean;
  editable?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}

export const Input: React.FC<InputProps> = ({
  label,
  placeholder,
  value,
  onChangeText,
  secureTextEntry = false,
  keyboardType = 'default',
  autoCapitalize = 'none',
  error,
  style,
  multiline = false,
  editable = true,
  accessibilityLabel,
  accessibilityHint,
}) => {
  return (
    <View style={[styles.container, style]}>
      {label && <Text style={styles.label}>{label}</Text>}
      <TextInput
        style={[
          styles.input,
          error && styles.inputError,
          multiline && styles.multiline,
          !editable && styles.disabled,
        ]}
        placeholder={placeholder}
        placeholderTextColor="#999"
        value={value}
        onChangeText={onChangeText}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        multiline={multiline}
        editable={editable}
        accessibilityLabel={accessibilityLabel ?? label ?? placeholder}
        accessibilityHint={error ?? accessibilityHint}
        accessibilityState={{ disabled: !editable }}
      />
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    backgroundColor: '#fff',
    color: '#333',
    minHeight: 48,
  },
  inputError: {
    borderColor: '#dc3545',
  },
  error: {
    color: '#dc3545',
    fontSize: 12,
    marginTop: 4,
  },
  multiline: {
    minHeight: 100,
    textAlignVertical: 'top',
  },
  disabled: {
    backgroundColor: '#f5f5f5',
    color: '#666',
  },
});
