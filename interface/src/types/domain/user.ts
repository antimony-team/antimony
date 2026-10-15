export type User = {
  id: string;
  name: string;
};

// Used to represent the logged-in user.
export type AuthenticatedUser = User & {
  isAdmin: boolean;
};

export type AuthMethod = 'admin' | 'openid' | 'desktop';

export type AuthConfig = {
  methods: AuthMethod[];
};

export const EMPTY_AUTH_USER = {
  id: '',
  name: '',
  isAdmin: false,
};
