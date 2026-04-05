export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  initials: string | null;
}

let user = $state<AuthUser | null>(null);
let token = $state<string | null>(null);
let initialised = $state(false);

function init() {
  if (initialised) return;
  initialised = true;

  const storedToken = localStorage.getItem('auth_token');
  const storedUser = localStorage.getItem('auth_user');
  if (storedToken && storedUser) {
    try {
      token = storedToken;
      user = JSON.parse(storedUser);
    } catch {
      localStorage.removeItem('auth_token');
      localStorage.removeItem('auth_user');
    }
  }
}

function login(jwt: string, authUser: AuthUser) {
  token = jwt;
  user = authUser;
  localStorage.setItem('auth_token', jwt);
  localStorage.setItem('auth_user', JSON.stringify(authUser));
}

function updateUser(authUser: AuthUser) {
  user = authUser;
  localStorage.setItem('auth_user', JSON.stringify(authUser));
}

function logout() {
  token = null;
  user = null;
  localStorage.removeItem('auth_token');
  localStorage.removeItem('auth_user');
}

export function useAuth() {
  init();
  return {
    get user() {
      return user;
    },
    get token() {
      return token;
    },
    get isAuthenticated() {
      return !!token;
    },
    get needsProfile() {
      return !!token && !!user && (!user.name || !user.initials);
    },
    login,
    updateUser,
    logout,
  };
}
