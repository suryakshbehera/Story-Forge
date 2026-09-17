import { useColorScheme as useColorSchemeCore } from 'react-native';

/**
 * Dark-first: an unspecified system scheme (or one RN can't read yet) resolves
 * to 'dark', not 'light' — see constants/Colors.ts.
 */
export const useColorScheme = () => {
  const coreScheme = useColorSchemeCore();
  return coreScheme === 'light' ? 'light' : 'dark';
};
