// Polish banks with brand colors (brand color + text color for badges).

export interface Bank {
  id: string;
  name: string;
  /** Brand color in hex. */
  brandColor: string;
  /** Text color in hex (for contrast). */
  textColor: string;
}

export const BANKS: Record<string, Bank> = {
  pko_bp: { id: 'pko_bp', name: 'PKO BP', brandColor: '#FFC400', textColor: '#000000' },
  pekao: { id: 'pekao', name: 'Pekao', brandColor: '#004B87', textColor: '#FFFFFF' },
  santander: { id: 'santander', name: 'Santander', brandColor: '#DA0015', textColor: '#FFFFFF' },
  mbank: { id: 'mbank', name: 'mBank', brandColor: '#E8003A', textColor: '#FFFFFF' },
  ing: { id: 'ing', name: 'ING', brandColor: '#FF6B00', textColor: '#FFFFFF' },
  bnp_paribas: { id: 'bnp_paribas', name: 'BNP Paribas', brandColor: '#008000', textColor: '#FFFFFF' },
  alior: { id: 'alior', name: 'Alior', brandColor: '#EF3B39', textColor: '#FFFFFF' },
  millennium: { id: 'millennium', name: 'Millennium', brandColor: '#1E3932', textColor: '#FFFFFF' },
  credit_agricole: { id: 'credit_agricole', name: 'Credit Agricole', brandColor: '#003F2F', textColor: '#FFFFFF' },
  citi_handlowy: { id: 'citi_handlowy', name: 'Citi Handlowy', brandColor: '#0066CC', textColor: '#FFFFFF' },
  velobank: { id: 'velobank', name: 'VeloBank', brandColor: '#FFB81C', textColor: '#000000' },
  nest: { id: 'nest', name: 'Nest', brandColor: '#7F39FB', textColor: '#FFFFFF' },
  bos: { id: 'bos', name: 'BOŚ', brandColor: '#00A34D', textColor: '#FFFFFF' },
  pocztowy: { id: 'pocztowy', name: 'Pocztowy', brandColor: '#FFD700', textColor: '#000000' },
  revolut: { id: 'revolut', name: 'Revolut', brandColor: '#0066FF', textColor: '#FFFFFF' },
  other: { id: 'other', name: 'Inny', brandColor: '#808080', textColor: '#FFFFFF' },
};

export const BANK_OPTIONS = Object.values(BANKS).map((b) => ({ id: b.id, name: b.name }));

export function getBankById(id: string | null): Bank | null {
  if (!id) return null;
  return BANKS[id] ?? null;
}
