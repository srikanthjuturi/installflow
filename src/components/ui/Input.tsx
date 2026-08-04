import { useState } from 'react';
import { Text, TextInput, View, type KeyboardTypeOptions } from 'react-native';

import { color } from '@/theme/semantic';
import { radius } from '@/theme/spacing';

export interface InputProps {
  label?: string;
  value: string;
  onChangeText: (next: string) => void;
  placeholder?: string;
  /** Static leading text inside the field, e.g. the '+91' dial code. */
  prefix?: string;
  keyboardType?: KeyboardTypeOptions;
  maxLength?: number;
  error?: string;
  editable?: boolean;
  autoFocus?: boolean;
}

export function Input({
  label,
  value,
  onChangeText,
  placeholder,
  prefix,
  keyboardType,
  maxLength,
  error,
  editable = true,
  autoFocus = false,
}: InputProps) {
  const [focused, setFocused] = useState(false);

  const borderColor = error ? color.debit : focused ? color.borderFocus : color.border;

  return (
    <View>
      {label ? (
        <Text
          style={{
            fontFamily: 'Roboto_500Medium',
            fontSize: 12,
            color: color.textSecondary,
            marginBottom: 6,
          }}
        >
          {label}
        </Text>
      ) : null}

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          height: 52,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor,
          backgroundColor: editable ? color.surfaceRaised : color.surfaceSunken,
          paddingHorizontal: 14,
        }}
      >
        {prefix ? (
          <Text
            style={{
              fontFamily: 'Roboto_500Medium',
              fontSize: 16,
              color: color.textSecondary,
              marginRight: 8,
            }}
          >
            {prefix}
          </Text>
        ) : null}

        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={color.textMuted}
          keyboardType={keyboardType}
          maxLength={maxLength}
          editable={editable}
          autoFocus={autoFocus}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            flex: 1,
            fontFamily: 'Roboto_500Medium',
            fontSize: 16,
            color: editable ? color.textPrimary : color.textSecondary,
            padding: 0,
          }}
        />
      </View>

      {error ? (
        <Text
          style={{
            fontFamily: 'Roboto_400Regular',
            fontSize: 12,
            color: color.debit,
            marginTop: 6,
          }}
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}
