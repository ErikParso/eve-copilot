import { Box, Card, CardContent, Divider, Skeleton } from '@mui/material';

export function OpportunityCardSkeleton() {
  return (
    <Card
      variant="outlined"
      sx={{
        height: '100%',
        minHeight: 340, // Match the height of the actual opportunity cards
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        overflow: 'hidden',
        borderColor: 'divider',
        borderWidth: '1px',
        margin: '0px',
      }}
    >
      <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, flex: 1, minWidth: 0 }}>
        {/* Reward / Profit placeholder */}
        <Box>
          <Skeleton variant="text" width={70} height={16} sx={{ mb: 0.5 }} />
          <Skeleton variant="text" width={130} height={32} />
        </Box>

        <Divider />

        {/* Title and subtitle placeholders */}
        <Box>
          <Skeleton variant="text" width={180} height={20} sx={{ mb: 0.5 }} />
          <Skeleton variant="text" width={110} height={14} />
        </Box>

        {/* Location placeholders */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
          <Skeleton variant="text" width={28} height={14} />
          <Skeleton variant="rectangular" width={140} height={16} sx={{ borderRadius: 0.5 }} />
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Skeleton variant="text" width={28} height={14} />
          <Skeleton variant="rectangular" width={140} height={16} sx={{ borderRadius: 0.5 }} />
        </Box>
      </CardContent>
    </Card>
  );
}
