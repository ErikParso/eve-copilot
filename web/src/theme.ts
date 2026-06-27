import { createTheme } from '@mui/material/styles';

/** Dark, EVE-flavoured theme shared across the whole app. */
export const theme = createTheme({
	palette: {
		mode: 'dark',
		primary: { main: '#4dd0e1' },
		secondary: { main: '#ffb74d' },
		background: {
			default: '#0d1117',
			paper: '#161b22',
		},
	},
	shape: { borderRadius: 8 },
	typography: {
		fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
	},
	components: {
		MuiCssBaseline: {
			styleOverrides: {
				body: {
					backgroundImage: `url('/background1.png')`,
					backgroundSize: 'cover',
					backgroundPosition: 'center',
					backgroundRepeat: 'no-repeat',
					backgroundAttachment: 'fixed',
				},
			},
		},
	},
});
