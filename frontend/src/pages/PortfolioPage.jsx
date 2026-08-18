import { useState, useEffect } from 'react';
import AppShell from '../components/AppShell';
import { Image, Play, X } from '../components/icons';
import { api } from '../lib/api';
import { LoadingBlock, ErrorBlock, EmptyBlock, Spinner, useToast } from '../lib/ui-state';

/**
 * Creator Portfolio (feature #10). Real uploaded work samples only — no
 * fabricated view/like counts. Uses the existing presigned-upload-url flow
 * (same pattern as the brand logo upload) so files go straight to storage.
 */
export default function PortfolioPage() {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [uploading, setUploading] = useState(false);
  const toast = useToast();

  const load = async () => {
    setLoading(true); setError(null);
    try { const { data } = await api.myProfile(); setProfile(data); }
    catch (e) { setError(e); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  async function onPick(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const { data: urls } = await api.portfolioUploadUrl(file.name, file.type);
      // Mock storage returns a deterministic publicUrl immediately; a real S3/
      // Cloudinary provider would need an actual PUT to uploadUrl here first.
      if (urls?.uploadUrl && !urls.uploadUrl.includes('mock-storage')) {
        await fetch(urls.uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
      }
      const { data: portfolio } = await api.addPortfolioItem({
        title: file.name.replace(/\.[^.]+$/, ''),
        mediaUrl: urls.publicUrl,
        mediaType: file.type.startsWith('video') ? 'video' : 'image',
      });
      setProfile((p) => ({ ...p, portfolio }));
      toast.push('Added to portfolio ✓', 'success');
    } catch (err) { toast.push(err.message, 'error'); } finally { setUploading(false); e.target.value = ''; }
  }

  async function remove(itemId) {
    try {
      const { data: portfolio } = await api.deletePortfolioItem(itemId);
      setProfile((p) => ({ ...p, portfolio }));
    } catch (e) { toast.push(e.message, 'error'); }
  }

  return (
    <AppShell>
      <div className="max-w-[1000px] mx-auto px-4 sm:px-6 py-6">
        <div className="flex items-center justify-between mb-1">
          <h1 className="font-display font-extrabold text-2xl text-ink">Portfolio</h1>
          <label className="btn-cta text-sm cursor-pointer">
            {uploading ? <Spinner className="w-4 h-4" /> : <><Image className="w-4 h-4" /> Add work</>}
            <input type="file" accept="image/*,video/*" className="hidden" onChange={onPick} disabled={uploading} />
          </label>
        </div>
        <p className="text-muted text-sm mb-5">Showcase your best work — brands see this on your public profile.</p>

        {loading ? <LoadingBlock /> : error ? <ErrorBlock error={error} onRetry={load} />
          : !profile?.portfolio?.length ? (
            <EmptyBlock title="No portfolio items yet" sub="Add a reel, post, or video to show brands your work." />
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              {profile.portfolio.map((item) => (
                <div key={item._id} className="relative group rounded-xl overflow-hidden border border-line bg-bg aspect-[3/4]">
                  <img src={item.thumbnailUrl || item.mediaUrl} alt={item.title} className="w-full h-full object-cover" />
                  {item.mediaType === 'video' && (
                    <span className="absolute bottom-2 left-2 text-white text-xs font-semibold inline-flex items-center gap-1 bg-black/40 rounded px-1.5 py-0.5">
                      <Play className="w-3 h-3" />
                    </span>
                  )}
                  <button onClick={() => remove(item._id)}
                    className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/50 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition">
                    <X className="w-3.5 h-3.5" />
                  </button>
                  {item.title && <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-2 text-white text-xs font-medium truncate">{item.title}</div>}
                </div>
              ))}
            </div>
          )}
      </div>
    </AppShell>
  );
}
