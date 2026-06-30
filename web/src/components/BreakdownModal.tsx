import { type ReactNode } from 'react';
import { Box, Dialog, DialogTitle, DialogContent, IconButton, Stack, Typography, Divider } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import SegmentIcon from '@mui/icons-material/Segment';

export interface BreakdownColumn {
  header: string;
  gridWidth: string; // e.g., '2fr' or '1fr'
  align?: 'left' | 'right' | 'center';
}

export interface BreakdownModalProps<T> {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  icon?: ReactNode;
  columns: BreakdownColumn[];
  items: T[];
  renderRow: (item: T, index: number) => ReactNode;
}

export function BreakdownModal<T>({
  open,
  onClose,
  title,
  description,
  icon = <SegmentIcon sx={{ color: 'primary.main' }} />,
  columns,
  items,
  renderRow,
}: BreakdownModalProps<T>) {
  // Construct gridTemplateColumns style
  const gridTemplateColumns = columns.map((col) => col.gridWidth).join(' ');

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      sx={(theme) => ({
        [theme.breakpoints.down('md')]: {
          '& .MuiDialog-container': {
            alignItems: 'flex-end',
          },
        },
      })}
      PaperProps={{
        sx: (theme) => ({
          borderRadius: 3,
          bgcolor: 'background.paper',
          backgroundImage: 'none',
          boxShadow: 24,
          [theme.breakpoints.down('md')]: {
            margin: 0,
            maxWidth: '100%',
            width: '100%',
            borderRadius: '20px 20px 0 0',
            maxHeight: '85vh',
          },
        }),
      }}
    >
      <DialogTitle sx={{ fontWeight: 800, pb: 1.5, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {icon}
          {title}
        </Box>
        <IconButton size="small" onClick={onClose} sx={{ color: 'text.secondary' }}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ borderColor: 'divider' }}>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            {description}
          </Typography>

          <Box
            sx={{
              borderRadius: 2,
              border: '1px solid',
              borderColor: 'divider',
              overflow: 'hidden',
              bgcolor: (theme) => (theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)'),
            }}
          >
            {/* Header */}
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns,
                gap: 1,
                p: 1.5,
                bgcolor: 'action.hover',
                borderBottom: '1px solid',
                borderColor: 'divider',
              }}
            >
              {columns.map((col, idx) => (
                <Typography
                  key={idx}
                  variant="caption"
                  sx={{
                    fontWeight: 700,
                    textAlign: col.align || 'left',
                  }}
                >
                  {col.header}
                </Typography>
              ))}
            </Box>

            {/* Rows */}
            <Stack divider={<Divider />} spacing={0}>
              {items.map((item, idx) => (
                <Box
                  key={idx}
                  sx={{
                    display: 'grid',
                    gridTemplateColumns,
                    gap: 1,
                    p: 1.5,
                    '&:hover': {
                      bgcolor: 'action.hover',
                    },
                  }}
                >
                  {renderRow(item, idx)}
                </Box>
              ))}
            </Stack>
          </Box>
        </Stack>
      </DialogContent>
    </Dialog>
  );
}
