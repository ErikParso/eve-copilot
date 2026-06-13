import { useMemo, useState } from 'react';
import {
  Box,
  Button,
  Container,
  FormControl,
  Grid,
  InputAdornment,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Typography,
  Autocomplete,
} from '@mui/material';

interface Contract {
  id: string;
  pickup: string;
  dropoff: string;
  volume: number;
  income: number;
  collateral: number;
  expiresAt: string; // ISO string
  routeJumps: number;
  pickupToDropoffJumps: number;
}

type AttractivityMethod = 'incomePerJump' | 'incomePerVolume' | 'riskAdjusted';

const attractivityMethods: Record<AttractivityMethod, { label: string; description: string }> = {
  incomePerJump: {
    label: 'Income per jump',
    description:
      'Prioritizes contracts with the highest income relative to total jumps, useful when time and travel distance matter.',
  },
  incomePerVolume: {
    label: 'Income per volume',
    description:
      'Prioritizes efficiency for cargo space by ranking high reward contracts for smaller volumes.',
  },
  riskAdjusted: {
    label: 'Risk-adjusted score',
    description:
      'Balances income with route safety preference and journey length for a more conservative selection.',
  },
};

const sampleSystems = [
  'Jita',
  'Amarr',
  'Dodixie',
  'Rens',
  'Hek',
  'Dodixie VI',
  'Sinq Laison',
  'Perimeter',
  'Tash-Murkon Prime',
  'Kador Prime',
];

const sampleContracts: Contract[] = [
  {
    id: 'C-2578',
    pickup: 'Jita IV - Moon 4 - Caldari Navy Assembly Plant',
    dropoff: 'Amarr VIII (Oris) - Emperor Family Academy',
    volume: 1600,
    income: 22_800_000,
    collateral: 4_500_000,
    expiresAt: new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString(),
    routeJumps: 3,
    pickupToDropoffJumps: 7,
  },
  {
    id: 'C-4214',
    pickup: 'Dodixie IX - Moon 20 - Federation Navy Assembly Plant',
    dropoff: 'Hek VIII - Moon 12 - Republic Fleet Assembly Plant',
    volume: 3200,
    income: 36_200_000,
    collateral: 7_800_000,
    expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
    routeJumps: 1,
    pickupToDropoffJumps: 5,
  },
  {
    id: 'C-9821',
    pickup: 'Rens VI - Moon 8 - Brutor Tribe Treasury',
    dropoff: 'Perimeter IV - Moon 4 - Republic Fleet Warehouse',
    volume: 2100,
    income: 18_600_000,
    collateral: 2_600_000,
    expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
    routeJumps: 4,
    pickupToDropoffJumps: 2,
  },
  {
    id: 'C-1073',
    pickup: 'Sinq Laison VII - Moon 2 - The Citadel',
    dropoff: 'Jita IV - Moon 4 - Caldari Navy Assembly Plant',
    volume: 5000,
    income: 53_000_000,
    collateral: 10_000_000,
    expiresAt: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
    routeJumps: 2,
    pickupToDropoffJumps: 10,
  },
];

const toMillions = (value: number) => `${(value / 1_000_000).toFixed(1)}M`;

const getTimeRemaining = (expiresAt: string) => {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return 'Expired';
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
};

const formatActiveTime = (expiresAt: string) => {
  const end = new Date(expiresAt);
  return end.toLocaleString();
};

const calculateAttractivity = (
  contract: Contract,
  method: AttractivityMethod,
  routeType: 'safest' | 'shortest'
) => {
  switch (method) {
    case 'incomePerJump':
      return contract.income / Math.max(1, contract.routeJumps + contract.pickupToDropoffJumps);
    case 'incomePerVolume':
      return contract.income / Math.max(1, contract.volume);
    case 'riskAdjusted':
      const jumpCount = routeType === 'safest' ? contract.routeJumps + contract.pickupToDropoffJumps : contract.pickupToDropoffJumps;
      return contract.income / Math.max(1, jumpCount) / (1 + contract.collateral / 10_000_000);
    default:
      return 0;
  }
};

const headers = [
  { key: 'pickup', label: 'Pickup location' },
  { key: 'dropoff', label: 'Dropoff location' },
  { key: 'volume', label: 'Volume' },
  { key: 'income', label: 'Income' },
  { key: 'jumpsCurrentToPickup', label: 'Jumps current → pickup' },
  { key: 'pickupToDropoffJumps', label: 'Pickup → dropoff' },
  { key: 'incomePerJump', label: 'Income / jump' },
  { key: 'activeTime', label: 'Active until' },
  { key: 'remaining', label: 'Time remaining' },
  { key: 'attractivity', label: 'Attractivity' },
];

const App = () => {
  const [maxCollateral, setMaxCollateral] = useState(10);
  const [maxVolume, setMaxVolume] = useState(5000);
  const [routeType, setRouteType] = useState<'safest' | 'shortest'>('safest');
  const [currentLocation, setCurrentLocation] = useState<string | null>(null);
  const [method, setMethod] = useState<AttractivityMethod>('incomePerJump');
  const [searchClicked, setSearchClicked] = useState(false);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc' | null>(null);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(5);

  const filteredContracts = useMemo(() => {
    const filtered = sampleContracts.filter((contract) => {
      return contract.collateral <= maxCollateral * 1_000_000 && contract.volume <= maxVolume;
    });

    const enhanced = filtered.map((contract) => {
      const currentToPickup = currentLocation ? contract.routeJumps : 0;
      const attractivity = calculateAttractivity(contract, method, routeType);
      return {
        ...contract,
        currentToPickup,
        attractivity,
        incomePerJump: contract.income / Math.max(1, currentToPickup + contract.pickupToDropoffJumps),
      };
    });

    if (!sortKey || !sortDirection) return enhanced;

    return [...enhanced].sort((a, b) => {
      const left = (a as any)[sortKey] ?? 0;
      const right = (b as any)[sortKey] ?? 0;
      if (typeof left === 'string' && typeof right === 'string') {
        const cmp = left.localeCompare(right);
        return sortDirection === 'asc' ? cmp : -cmp;
      }
      return sortDirection === 'asc' ? left - right : right - left;
    });
  }, [maxCollateral, maxVolume, currentLocation, method, routeType, sortKey, sortDirection]);

  const visibleContracts = searchClicked ? filteredContracts : [];

  const handleSort = (key: string) => {
    if (sortKey === key) {
      if (sortDirection === 'asc') {
        setSortDirection('desc');
      } else if (sortDirection === 'desc') {
        setSortKey(null);
        setSortDirection(null);
      } else {
        setSortDirection('asc');
      }
    } else {
      setSortKey(key);
      setSortDirection('asc');
    }
  };

  const rows = visibleContracts.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Typography variant="h4" gutterBottom>
        EVE Courier Contract Helper
      </Typography>
      <Typography variant="body1" paragraph>
        Filter delivery contracts by collateral, cargo size, and route preference. Use the attractivity method to compare deal quality.
      </Typography>

      <Paper sx={{ p: 3, mb: 4 }}>
        <Grid container spacing={2}>
          <Grid item xs={12} sm={6} md={3}>
            <TextField
              label="Max collateral (M)"
              type="number"
              value={maxCollateral}
              fullWidth
              inputProps={{ min: 0 }}
              onChange={(event) => setMaxCollateral(Number(event.target.value))}
            />
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <TextField
              label="Max cargo (m³)"
              type="number"
              value={maxVolume}
              fullWidth
              inputProps={{ min: 0 }}
              onChange={(event) => setMaxVolume(Number(event.target.value))}
            />
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <FormControl fullWidth>
              <TextField
                select
                label="Route type"
                value={routeType}
                onChange={(event) => setRouteType(event.target.value as 'safest' | 'shortest')}
              >
                <MenuItem value="safest">Safest</MenuItem>
                <MenuItem value="shortest">Shortest</MenuItem>
              </TextField>
            </FormControl>
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <Autocomplete
              freeSolo
              options={sampleSystems}
              value={currentLocation}
              onChange={(_, value) => setCurrentLocation(value)}
              onInputChange={(_, value) => setCurrentLocation(value)}
              renderInput={(params) => <TextField {...params} label="Current location" fullWidth />}
            />
          </Grid>
          <Grid item xs={12} sm={6} md={4}>
            <FormControl fullWidth>
              <TextField
                select
                label="Attractivity method"
                value={method}
                onChange={(event) => setMethod(event.target.value as AttractivityMethod)}
              >
                {Object.entries(attractivityMethods).map(([key, value]) => (
                  <MenuItem key={key} value={key}>
                    {value.label}
                  </MenuItem>
                ))}
              </TextField>
            </FormControl>
          </Grid>
          <Grid item xs={12} sm={6} md={8}>
            <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 2, height: '100%' }}>
              <Typography fontWeight={600} gutterBottom>
                {attractivityMethods[method].label}
              </Typography>
              <Typography variant="body2">{attractivityMethods[method].description}</Typography>
            </Box>
          </Grid>
          <Grid item xs={12}>
            <Button variant="contained" onClick={() => setSearchClicked(true)}>
              Search contracts
            </Button>
          </Grid>
        </Grid>
      </Paper>

      <Paper>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                {headers.map((header) => (
                  <TableCell
                    key={header.key}
                    onClick={() => handleSort(header.key)}
                    sx={{ cursor: 'pointer', userSelect: 'none' }}
                  >
                    <Stack direction="row" alignItems="center" spacing={1}>
                      <span>{header.label}</span>
                      {sortKey === header.key ? (
                        <span>{sortDirection === 'asc' ? '▲' : sortDirection === 'desc' ? '▼' : ''}</span>
                      ) : null}
                    </Stack>
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={headers.length} align="center">
                    {searchClicked ? 'No contracts match the filter.' : 'Click search to load matching contracts.'}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((contract) => (
                  <TableRow key={contract.id} hover>
                    <TableCell>{contract.pickup}</TableCell>
                    <TableCell>{contract.dropoff}</TableCell>
                    <TableCell>{contract.volume.toLocaleString()} m³</TableCell>
                    <TableCell>{contract.income.toLocaleString()} ISK</TableCell>
                    <TableCell>
                      {currentLocation ? contract.currentToPickup : '-'}
                    </TableCell>
                    <TableCell>{contract.pickupToDropoffJumps}</TableCell>
                    <TableCell>{Math.round(contract.incomePerJump).toLocaleString()} ISK</TableCell>
                    <TableCell>{formatActiveTime(contract.expiresAt)}</TableCell>
                    <TableCell>{getTimeRemaining(contract.expiresAt)}</TableCell>
                    <TableCell>{contract.attractivity.toFixed(1)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination
          component="div"
          count={visibleContracts.length}
          page={page}
          onPageChange={(_, newPage) => setPage(newPage)}
          rowsPerPage={rowsPerPage}
          onRowsPerPageChange={(event) => {
            setRowsPerPage(parseInt(event.target.value, 10));
            setPage(0);
          }}
          rowsPerPageOptions={[5, 10, 25]}
        />
      </Paper>
    </Container>
  );
};

export default App;
