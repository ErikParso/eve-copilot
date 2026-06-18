// The ship's cargo, maintained by the Copilot itself (ESI can't read an active
// ship's hold). Populated by completing buy steps; editable here so the user can
// reconcile drift (partial buys, pre-existing cargo, in-game trades). Persists
// across reloads and mode switches — it's the bridge between buy and sell runs.
import { useState } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { Box, Button, IconButton, Stack, TextField, Tooltip, Typography } from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { formatIskMillions, formatNumber, formatVolume } from '@/utils/format';
import { inventoryAtom, inventoryVolumeAtom } from '../atoms';
import { setHoldingQty, type Holding } from '../types';

/** Inline quantity editor that commits on blur / Enter and reverts on Escape. */
function QtyField({ holding, onCommit }: { holding: Holding; onCommit: (qty: number) => void }) {
  const [draft, setDraft] = useState(String(holding.qty));

  const commit = () => {
    const n = Math.max(0, Math.floor(Number(draft)));
    if (!Number.isFinite(n)) {
      setDraft(String(holding.qty));
      return;
    }
    if (n !== holding.qty) onCommit(n);
    else setDraft(String(holding.qty));
  };

  return (
    <TextField
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') setDraft(String(holding.qty));
      }}
      size="small"
      type="number"
      inputProps={{ min: 0, 'aria-label': `${holding.itemName} quantity`, style: { padding: '2px 6px', width: 72 } }}
      sx={{ '& .MuiInputBase-root': { fontSize: '0.75rem' } }}
    />
  );
}

export function ShipInventoryPanel() {
  const [inventory, setInventory] = useAtom(inventoryAtom);
  const totalVolume = useAtomValue(inventoryVolumeAtom);

  const setQty = (typeId: number, qty: number) =>
    setInventory((prev) => setHoldingQty(prev, typeId, qty));
  const remove = (typeId: number) => setInventory((prev) => prev.filter((h) => h.typeId !== typeId));

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
        <Typography variant="subtitle2">Ship inventory ({inventory.length})</Typography>
        {inventory.length > 0 && (
          <Button size="small" color="inherit" onClick={() => setInventory([])}>
            Clear
          </Button>
        )}
      </Box>

      {inventory.length === 0 ? (
        <Typography variant="caption" color="text.secondary">
          Empty hold. Cargo you buy on a buy run lands here, then a sell run finds buyers for it.
        </Typography>
      ) : (
        <Stack spacing={1}>
          {inventory.map((h) => (
            <Box
              key={h.typeId}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                p: 1,
                borderRadius: 1,
                bgcolor: 'action.hover',
              }}
            >
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography variant="caption" sx={{ fontWeight: 700 }} noWrap title={h.itemName}>
                  {h.itemName}
                </Typography>
                <Typography variant="caption" color="text.secondary" display="block" noWrap>
                  {formatVolume(h.qty * h.unitVolumeM3)} · cost {formatIskMillions(h.qty * h.unitCostBasis)}
                </Typography>
              </Box>
              <QtyField holding={h} onCommit={(qty) => setQty(h.typeId, qty)} />
              <Tooltip title="Remove from hold" arrow>
                <IconButton size="small" onClick={() => remove(h.typeId)}>
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Box>
          ))}
          <Box sx={{ display: 'flex', justifyContent: 'space-between', pt: 0.5 }}>
            <Typography variant="caption" color="text.secondary">
              Total cargo
            </Typography>
            <Typography variant="caption" sx={{ fontWeight: 700 }}>
              {formatVolume(totalVolume)} · {formatNumber(inventory.reduce((s, h) => s + h.qty, 0), 0)} units
            </Typography>
          </Box>
        </Stack>
      )}
    </Box>
  );
}
