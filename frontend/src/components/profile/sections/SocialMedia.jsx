import SocialConnectCard from '../../SocialConnectCard';
import FacebookPages from '../FacebookPages';
import { Check } from '../../icons';
import { api } from '../../../lib/api';
import { SectionCard, followerCount } from '../shared';

/**
 * The three platform connections.
 *
 * Instagram and YouTube are one account each, so they keep the shared
 * `SocialConnectCard` — connect, sync, disconnect, all identical across
 * platforms, which is the point of that component.
 *
 * Facebook is different in kind rather than in degree: a person may administer
 * several Pages and connect all of them, each with its own follower count, its
 * own capabilities and its own sync. That does not fit a card built around one
 * account, so it has its own component rather than a `SocialConnectCard` bent
 * out of shape to hold a list.
 */
export default function SocialMedia({ profile, onChanged }) {
  return (
    <div className="space-y-5">
      <SectionCard
        title="Connected accounts"
        description="Your audience and engagement figures come from the accounts you connect, which is what lets brands search on verified data rather than numbers you typed in."
      >
        <div className="rounded-xl2 border border-brand-100 bg-gradient-to-r from-brand-50/70 to-pink-50/50 p-4">
          <p className="text-sm text-ink leading-relaxed">
            Connecting an account never gives Marqueiver the ability to post as you unless you ask
            for it. Figures refresh when you sync, and stop the moment you disconnect.
          </p>
        </div>
      </SectionCard>

      <SectionCard
        title="Instagram"
        description="A Creator or Business account is required — that is a Meta requirement, not ours."
      >
        <SocialConnectCard
          platform="instagram"
          label="Instagram"
          successParam="ig"
          fetchProfile={api.instagramProfile}
          getAuthUrl={api.instagramAuthUrl}
          sync={api.instagramSync}
          disconnect={api.instagramDisconnect}
          onChange={onChanged}
          bare
          renderConnected={(ig) => (
            <>
              <div className="font-semibold text-ink flex items-center gap-1 truncate">
                @{ig.username} <Check className="w-4 h-4 text-jade-600 shrink-0" />
              </div>
              <div className="text-sm text-muted">
                <span className="tnum">{followerCount(ig.followers)}</span> followers ·{' '}
                <span className="tnum">{followerCount(ig.following)}</span> following ·{' '}
                {ig.mediaCount || 0} posts
              </div>
              {ig.lastSyncedAt && (
                <div className="text-[11px] text-muted mt-0.5">
                  Last synced {new Date(ig.lastSyncedAt).toLocaleString('en-IN')}
                </div>
              )}
            </>
          )}
        />
      </SectionCard>

      <SectionCard
        title="Facebook Pages"
        description="Connect every Page you run. One of them represents you publicly; the rest are managed here."
      >
        <FacebookPages onChange={onChanged} />
      </SectionCard>

      <SectionCard title="YouTube">
        <SocialConnectCard
          platform="youtube"
          label="YouTube"
          successParam="yt"
          fetchProfile={api.youtubeProfile}
          getAuthUrl={api.youtubeAuthUrl}
          sync={api.youtubeSync}
          disconnect={api.disconnectYoutube}
          onChange={onChanged}
          bare
          renderConnected={(yt) => (
            <>
              <div className="font-semibold text-ink flex items-center gap-1 truncate">
                {yt.title} <Check className="w-4 h-4 text-jade-600 shrink-0" />
              </div>
              <div className="text-sm text-muted">
                <span className="tnum">{followerCount(yt.subscriberCount)}</span> subscribers ·{' '}
                {yt.videoCount || 0} videos
              </div>
              {yt.lastSyncedAt && (
                <div className="text-[11px] text-muted mt-0.5">
                  Last synced {new Date(yt.lastSyncedAt).toLocaleString('en-IN')}
                </div>
              )}
            </>
          )}
        />
      </SectionCard>

      {/*
        Facebook as a whole, separated from the per-Page controls above so that
        "remove one Page" and "revoke the authorisation entirely" are never one
        mis-tap apart.
      */}
      <SectionCard
        title="Disconnect Facebook entirely"
        description="Removes every connected Page and the authorisation behind them. Individual Pages can be removed from their own card above."
      >
        <SocialConnectCard
          platform="facebook"
          label="Facebook"
          successParam="fb"
          fetchProfile={api.facebookProfile}
          disconnect={api.disconnectFacebook}
          onChange={onChanged}
          bare
          disconnectOnly
          renderConnected={(fb) => (
            <>
              <div className="font-semibold text-ink truncate">
                Authorised as {fb.facebookUserName || 'your Facebook account'}
              </div>
              <div className="text-sm text-muted">
                Disconnecting removes every Page at once.
              </div>
            </>
          )}
        />
      </SectionCard>
    </div>
  );
}