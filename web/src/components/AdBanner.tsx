import { useState, useEffect } from 'react';
import { Box, IconButton, Typography, Button, Paper, useTheme, useMediaQuery } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import LocalShippingIcon from '@mui/icons-material/LocalShipping';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';

interface AdBannerProps {
  onVisibilityChange?: (visible: boolean) => void;
}

const STORAGE_KEY = 'eve_copilot_ad_banner_hidden_until';
const HIDE_DURATION_MS = 1000 * 60 * 60 * 12; // Hide for 12 hours once closed

export function AdBanner({ onVisibilityChange }: AdBannerProps) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [isVisible, setIsVisible] = useState(false);

  // Environment variables for AdSense
  const clientId = import.meta.env.VITE_ADSENSE_CLIENT_ID;
  const desktopSlotId = import.meta.env.VITE_ADSENSE_DESKTOP_SLOT_ID;
  const mobileSlotId = import.meta.env.VITE_ADSENSE_MOBILE_SLOT_ID;

  const slotId = isMobile ? mobileSlotId : desktopSlotId;
  const isAdsenseConfigured = !!(clientId && slotId);

  useEffect(() => {
    // Check if user previously closed the ad and if the hide duration has expired
    const hiddenUntil = localStorage.getItem(STORAGE_KEY);
    if (hiddenUntil) {
      const hideTime = parseInt(hiddenUntil, 10);
      if (Date.now() < hideTime) {
        setIsVisible(false);
        onVisibilityChange?.(false);
        return;
      }
    }
    setIsVisible(true);
    onVisibilityChange?.(true);
  }, [onVisibilityChange]);

  // Load AdSense script once mounted and visible
  useEffect(() => {
    if (isVisible && isAdsenseConfigured) {
      try {
        // @ts-ignore
        (window.adsbygoogle = window.adsbygoogle || []).push({});
      } catch (e) {
        console.error('AdSense initialisation error:', e);
      }
    }
  }, [isVisible, isAdsenseConfigured, slotId]);

  const handleClose = () => {
    setIsVisible(false);
    onVisibilityChange?.(false);
    // Persist closed state for 12 hours
    localStorage.setItem(STORAGE_KEY, (Date.now() + HIDE_DURATION_MS).toString());
  };

  if (!isVisible) return null;

  return (
    <Box
      sx={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 1100,
        bgcolor: 'rgba(10, 15, 26, 0.95)',
        backdropFilter: 'blur(8px)',
        borderTop: '1px solid',
        borderColor: 'rgba(56, 189, 248, 0.2)', // Soft glowing cyan border
        boxShadow: '0 -4px 20px rgba(0, 0, 0, 0.5), 0 -2px 10px rgba(56, 189, 248, 0.1)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        py: 1,
        px: 2,
        transition: 'transform 0.3s ease-in-out',
      }}
    >
      {/* Ad Label & Close Button Bar */}
      <Box
        sx={{
          width: isMobile ? 320 : 728,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          mb: 0.5,
        }}
      >
        <Typography
          variant="caption"
          sx={{
            color: 'text.secondary',
            fontSize: '9px',
            textTransform: 'uppercase',
            letterSpacing: '1.5px',
            fontWeight: 600,
            opacity: 0.6,
          }}
        >
          Sponsored Advertisement
        </Typography>
        <IconButton
          onClick={handleClose}
          size="small"
          aria-label="close advertisement"
          sx={{
            color: 'text.secondary',
            p: 0,
            '&:hover': { color: 'error.main' },
          }}
        >
          <CloseIcon sx={{ fontSize: '14px' }} />
        </IconButton>
      </Box>

      {/* Ad Content Container */}
      <Paper
        elevation={0}
        sx={{
          width: isMobile ? 320 : 728,
          height: isMobile ? 50 : 90,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          borderRadius: 1,
          bgcolor: '#030712',
          border: '1px solid',
          borderColor: 'rgba(255, 255, 255, 0.05)',
        }}
      >
        {isAdsenseConfigured ? (
          <ins
            key={isMobile ? 'mobile-ad' : 'desktop-ad'} // Recreate DOM node on resize to avoid AdSense sizing issues
            className="adsbygoogle"
            style={{ display: 'inline-block', width: isMobile ? 320 : 728, height: isMobile ? 50 : 90 }}
            data-ad-client={clientId}
            data-ad-slot={slotId}
          />
        ) : (
          /* EVE-themed Premium Fallback Ad Banner (shows if env vars are missing) */
          <Box
            component="a"
            href="https://www.pushx.net/"
            target="_blank"
            rel="noopener noreferrer"
            sx={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              textDecoration: 'none',
              color: 'inherit',
              position: 'relative',
              background: 'linear-gradient(135deg, #090e17 0%, #1e1b4b 50%, #030712 100%)',
              px: isMobile ? 1.5 : 3,
              '&::after': {
                content: '""',
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                border: '1px solid transparent',
                borderRadius: 'inherit',
                background: 'linear-gradient(135deg, rgba(56, 189, 248, 0.3), rgba(99, 102, 241, 0.3)) border-box',
                WebkitMask: 'linear-gradient(#fff 0 0) padding-box, linear-gradient(#fff 0 0)',
                WebkitMaskComposite: 'xor',
                maskComposite: 'exclude',
                opacity: 0.5,
                transition: 'opacity 0.3s ease',
              },
              '&:hover::after': {
                opacity: 1,
              },
              '&:hover .ad-button': {
                transform: 'scale(1.05)',
                boxShadow: '0 0 12px rgba(56, 189, 248, 0.4)',
              },
            }}
          >
            {/* Ad Left Section: Icon & Slogan */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: isMobile ? 1 : 2 }}>
              <Box
                sx={{
                  bgcolor: 'rgba(56, 189, 248, 0.1)',
                  p: isMobile ? 0.75 : 1.25,
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'sky.400',
                  border: '1px solid rgba(56, 189, 248, 0.2)',
                }}
              >
                <LocalShippingIcon sx={{ fontSize: isMobile ? '20px' : '28px', color: '#38bdf8' }} />
              </Box>
              <Box>
                <Typography
                  variant="subtitle2"
                  sx={{
                    fontWeight: 800,
                    fontSize: isMobile ? '12px' : '15px',
                    letterSpacing: '0.5px',
                    background: 'linear-gradient(to right, #38bdf8, #818cf8)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    lineHeight: 1.2,
                  }}
                >
                  PushX Logistics
                </Typography>
                <Typography
                  variant="body2"
                  sx={{
                    color: 'grey.400',
                    fontSize: isMobile ? '9px' : '11px',
                    fontWeight: 500,
                    maxWidth: isMobile ? 180 : 380,
                    lineHeight: 1.3,
                    mt: 0.2,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {isMobile 
                    ? 'We haul your assets safely across New Eden.' 
                    : 'Fast, secure, and reliable courier service. Get your custom quote instantly.'}
                </Typography>
              </Box>
            </Box>

            {/* Ad Right Section: Button */}
            <Button
              className="ad-button"
              variant="contained"
              size={isMobile ? 'small' : 'medium'}
              endIcon={<OpenInNewIcon sx={{ fontSize: isMobile ? 12 : 16 }} />}
              sx={{
                bgcolor: '#0284c7',
                color: '#ffffff',
                fontWeight: 700,
                fontSize: isMobile ? '10px' : '12px',
                px: isMobile ? 1.5 : 2.5,
                py: isMobile ? 0.5 : 0.75,
                borderRadius: 1.5,
                textTransform: 'none',
                boxShadow: '0 4px 10px rgba(2, 132, 199, 0.2)',
                transition: 'all 0.2s ease-in-out',
                whiteSpace: 'nowrap',
                '&:hover': {
                  bgcolor: '#0369a1',
                },
              }}
            >
              {isMobile ? 'Quote' : 'Calculate Quote'}
            </Button>
          </Box>
        )}
      </Paper>
    </Box>
  );
}

