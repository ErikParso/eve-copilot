import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Box, Button, CircularProgress, Stack, Typography } from '@mui/material';
import { decodeToken, exchangeCode } from '@/api/sso';
import { useAuth, STATE_KEY, VERIFIER_KEY } from './useAuth';

/** Handles the SSO redirect: exchanges the code for tokens, stores the character. */
export function AuthCallbackPage() {
  const navigate = useNavigate();
  const { addCharacter } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return; // guard against StrictMode double-invoke
    ran.current = true;

    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');
    const verifier = sessionStorage.getItem(VERIFIER_KEY);
    const savedState = sessionStorage.getItem(STATE_KEY);
    sessionStorage.removeItem(VERIFIER_KEY);
    sessionStorage.removeItem(STATE_KEY);

    if (!code || !state || !verifier || state !== savedState) {
      setError('Invalid or expired login response. Please try logging in again.');
      return;
    }

    exchangeCode(code, verifier)
      .then((tok) => {
        const decoded = decodeToken(tok.access_token);
        addCharacter({
          characterId: decoded.characterId,
          name: decoded.name,
          scopes: decoded.scopes,
          accessToken: tok.access_token,
          refreshToken: tok.refresh_token,
          expiresAt: decoded.expiresAt,
        });
        navigate('/couriers', { replace: true });
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Login failed');
      });
  }, [addCharacter, navigate]);

  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
      {error ? (
        <Stack spacing={2} alignItems="center">
          <Alert severity="error">{error}</Alert>
          <Button variant="contained" onClick={() => navigate('/couriers', { replace: true })}>
            Back
          </Button>
        </Stack>
      ) : (
        <Stack spacing={2} alignItems="center">
          <CircularProgress />
          <Typography variant="body2" color="text.secondary">
            Signing you in…
          </Typography>
        </Stack>
      )}
    </Box>
  );
}
