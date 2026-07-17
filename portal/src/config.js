// Backend configuration. The anon key is public by design (RLS denies all
// client table access; the fl-* edge functions are the only doorway).
window.FL_CONFIG = {
  enabled: true,
  functionsUrl: 'https://jzfjpwoxglacrqxfhvjd.supabase.co/functions/v1',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp6Zmpwd294Z2xhY3JxeGZodmpkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE5Njk2NjAsImV4cCI6MjA5NzU0NTY2MH0.lw3vVePkxn4Ym543sgaxAopMtgyyegD9mXMlWE6_WcY',
  shareUrl: 'guvenser09-png.github.io/unbury',
};

// Ad configuration (v1.1): fill AdMob rewarded unit id to activate ads in the
// native app. Empty = ad-free build, no ad wording anywhere in the UI.
window.FL_ADS = {
  admobRewardedId: 'ca-app-pub-1508388843514752/7927208004',
  personalized: false, // non-personalized ads: no ATT prompt required
};
