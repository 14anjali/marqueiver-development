import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import AppShell from '../components/AppShell';
import CreatorCard from '../components/CreatorCard';
import { api } from '../lib/api';
import { creatorToCard } from '../lib/normalize';
import { LoadingBlock, ErrorBlock, EmptyBlock } from '../lib/ui-state';

export default function SavedCreatorsPage() {
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const nav = useNavigate();

  const load = async () => {
    setLoading(true); setError(null);
    try { const { data } = await api.listSavedCreators(); setCards((data || []).map(creatorToCard)); }
    catch (e) { setError(e); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const openCreator = (c) => nav(`/creator/${c.id}`, { state: { creator: c.raw || c } });
  const onSaveChange = (creatorProfileId, saved) => {
    // Unsaving from this page should remove the card immediately.
    if (!saved) setCards((list) => list.filter((c) => c.id !== creatorProfileId));
  };

  return (
    <AppShell>
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6">
        <h1 className="font-display font-extrabold text-2xl text-ink mb-1">Saved Creators</h1>
        <p className="text-muted text-sm mb-5">Creators you've bookmarked for later.</p>

        {loading ? <LoadingBlock /> : error ? <ErrorBlock error={error} onRetry={load} />
          : !cards.length ? <EmptyBlock title="No saved creators yet" sub="Tap the heart icon on any creator card to save them here." />
          : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
              {cards.map((c) => (
                <CreatorCard key={c.id} c={c} onOpen={openCreator} saved onSaveChange={onSaveChange} />
              ))}
            </div>
          )}
      </div>
    </AppShell>
  );
}
