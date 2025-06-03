export type User = {
  id: string;
  name: string;
};

// Used to represent the logged-in user.
export type AuthenticatedUser = User & {
  isAdmin: boolean;
};

export type AuthConfig = {
  openId: {
    enabled: boolean;
  };
  native: {
    enabled: boolean;
    allowEmpty: boolean;
  };
};

export const EMPTY_AUTH_USER = {
  id: '',
  name: '',
  isAdmin: false,
};
