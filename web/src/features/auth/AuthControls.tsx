import { Button, Tooltip } from '@mui/material';
import LoginIcon from '@mui/icons-material/Login';
import { useAuth } from './useAuth';
import { CharacterMenu } from './CharacterMenu';

/** App-bar auth control: avatar menu when logged in, else a login button. */
export function AuthControls() {
  const { active, login, configured } = useAuth();

  if (active) return <CharacterMenu />;

  if (!configured) {
    return (
      <Tooltip title="EVE SSO is not configured (set VITE_EVE_CLIENT_ID).">
        <span>
          <Button size="small" disabled>
            Log in
          </Button>
        </span>
      </Tooltip>
    );
  }

  return (
    <Button size="small" variant="outlined" startIcon={<LoginIcon />} onClick={() => void login()}>
      Log in with EVE
    </Button>
  );
}
