// The pieces the signed-in redesigns (home-v2.tsx, home-v3.tsx) are built
// from: a feed's cover, who is in it, how it is doing, its two copy buttons,
// its lists, its people, and the form that makes a new one.
import { useState, type FormEvent, type ReactNode } from 'react'
import {
  CheckIcon,
  ChevronRightIcon,
  CopyIcon,
  EllipsisIcon,
  FilmIcon,
  LinkIcon,
  LogOutIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
  TvIcon,
  XIcon,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { isSupportedImdbUrl, type SharedMember, type SharedSource } from '@/lib/api'
import { writeToClipboard } from '@/lib/clipboard'
import { notify } from '@/lib/notify'
import { formatRelativeTime } from '@/lib/relative-time'
import { cn } from '@/lib/utils'
import type { Feed, FeedsApi, Health } from '@/lib/use-feeds'

// ── Faces ────────────────────────────────────────────────────────────────────

const AVATAR_COLOURS = ['bg-sky-600', 'bg-emerald-600', 'bg-violet-600', 'bg-rose-600', 'bg-teal-600', 'bg-orange-600']

function colourFor(name: string) {
  let hash = 0
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return AVATAR_COLOURS[hash % AVATAR_COLOURS.length]
}

/** A person as their initial in a circle; the signed-in person in IMDb yellow. */
export function Avatar({
  name,
  you = false,
  className = 'size-7 text-xs',
}: {
  name: string | null
  you?: boolean
  className?: string
}) {
  const label = name ?? 'Someone'
  return (
    <span
      title={you ? `${label} (you)` : label}
      className={cn(
        'ring-card inline-flex shrink-0 items-center justify-center rounded-full font-bold ring-2 select-none',
        you ? 'bg-primary text-primary-foreground' : `${colourFor(label)} text-white`,
        className,
      )}
    >
      {label.slice(0, 1).toUpperCase()}
    </span>
  )
}

/** The first few people, overlapping, and how many more. */
export function AvatarStack({ members, max = 3, className }: { members: SharedMember[]; max?: number; className?: string }) {
  const shown = members.slice(0, max)
  const more = members.length - shown.length
  return (
    <span className={cn('flex items-center -space-x-1.5', className)} aria-label={`${members.length} people`}>
      {shown.map((member) => (
        <Avatar key={member.id} name={member.name} you={member.you} className="size-6 text-2xs" />
      ))}
      {more > 0 && (
        <span className="bg-secondary ring-card text-2xs inline-flex size-6 items-center justify-center rounded-full font-bold ring-2">
          +{more}
        </span>
      )}
    </span>
  )
}

// ── Cover ────────────────────────────────────────────────────────────────────

/**
 * A feed's cover, the way a playlist has one: four of its covers in a square,
 * or one when it has fewer, or a film mark while none are read yet.
 */
export function CoverMosaic({ posters, className = 'size-12' }: { posters: string[]; className?: string }) {
  const frame = cn('bg-secondary ring-foreground/10 shrink-0 overflow-hidden rounded-md ring-1', className)
  if (posters.length === 0) {
    return (
      <span className={cn(frame, 'text-muted-foreground flex items-center justify-center')} aria-hidden="true">
        <FilmIcon className="size-1/3" />
      </span>
    )
  }
  const tiles = posters.length >= 4 ? posters.slice(0, 4) : posters.slice(0, 1)
  return (
    <span className={cn(frame, tiles.length === 4 ? 'grid grid-cols-2 grid-rows-2' : 'block')} aria-hidden="true">
      {tiles.map((poster) => (
        <img key={poster} src={poster} alt="" loading="lazy" decoding="async" className="size-full object-cover" />
      ))}
    </span>
  )
}

// ── Status ───────────────────────────────────────────────────────────────────

const HEALTH = {
  ready: { dot: 'bg-emerald-500', label: 'Up to date' },
  pending: { dot: 'bg-amber-400 animate-pulse', label: 'Reading from IMDb' },
  error: { dot: 'bg-destructive', label: 'Cannot read a list' },
} as const satisfies Record<Health, { dot: string; label: string }>

/** A coloured dot and a word or two: how the feed's reads from IMDb are going. */
export function HealthDot({ health, label, className }: { health: Health; label?: string; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <span className={cn('size-2 shrink-0 rounded-full', HEALTH[health].dot)} aria-hidden="true" />
      {label ?? HEALTH[health].label}
    </span>
  )
}

// ── The two links ────────────────────────────────────────────────────────────

const APPS = {
  Radarr: { icon: FilmIcon, path: ['Settings', 'Lists', 'Add List', 'Radarr'] },
  Sonarr: { icon: TvIcon, path: ['Settings', 'Import Lists', 'Add List', 'Sonarr'] },
} as const

type App = keyof typeof APPS

/** "Radarr" with a copy mark: the link is what gets copied, not shown. */
export function CopyAppButton({
  app,
  url,
  variant = 'secondary',
  size = 'sm',
  className,
}: {
  app: App
  url: string
  variant?: 'secondary' | 'cta'
  size?: 'sm' | 'default' | 'cta'
  className?: string
}) {
  const [copied, setCopied] = useState(false)
  const Icon = APPS[app].icon

  async function copy() {
    try {
      await writeToClipboard(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
      void notify('success', `${app} link copied. Paste it in ${app} as the Full URL.`)
    } catch {
      void notify('error', 'Could not copy. Open the feed’s setup and copy the link from there.')
    }
  }

  return (
    <Button type="button" variant={variant} size={size} onClick={copy} className={className} title={url}>
      {copied ? <CheckIcon className="motion-safe:animate-pop" /> : <Icon />}
      {app}
      {!copied && <CopyIcon className="opacity-60" />}
    </Button>
  )
}

/** Where each link goes in its app, with the link itself for anyone who wants to see it. */
export function SetupSteps({ feed }: { feed: Feed }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {(Object.keys(APPS) as App[]).map((app) => {
        const url = app === 'Radarr' ? feed.radarrUrl : feed.sonarrUrl
        const Icon = APPS[app].icon
        return (
          <div key={app} className="bg-background/60 ring-foreground/10 rounded-lg p-4 ring-1">
            <p className="flex items-center gap-2 text-sm font-bold">
              <Icon className="text-ink size-4" aria-hidden="true" />
              {app}
            </p>
            <ol className="text-muted-foreground mt-2 flex flex-wrap items-center gap-x-1 text-xs" aria-label={`Where it goes in ${app}`}>
              {APPS[app].path.map((step, index) => (
                <li key={step} className="flex items-center gap-1">
                  {index > 0 && <ChevronRightIcon className="size-3 opacity-60" aria-hidden="true" />}
                  <span className={index === APPS[app].path.length - 1 ? 'text-foreground font-medium' : ''}>{step}</span>
                </li>
              ))}
            </ol>
            <p className="text-muted-foreground mt-3 truncate font-mono text-xs" title={url}>
              {url}
            </p>
            <div className="mt-3 flex items-center justify-between gap-2">
              <span className="text-muted-foreground text-xs">Full URL: this link. API Key: anything.</span>
              <CopyAppButton app={app} url={url} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── What else a feed can do ──────────────────────────────────────────────────

/** Rename, delete, leave or stop following: the rare actions, behind a ⋯. */
export function FeedMenu({ feed, api, onGone }: { feed: Feed; api: FeedsApi; onGone?: () => void }) {
  const me = feed.members.find((member) => member.you)

  function rename() {
    const name = window.prompt('A new name for this feed', feed.name)?.trim()
    if (name && name !== feed.name) void api.change(feed, { action: 'rename', body: { name } }, 'Renamed.')
  }

  async function remove() {
    if (!window.confirm(`Delete "${feed.name}"? Its Radarr and Sonarr links stop working for everyone.`)) return
    if (await api.change(feed, { action: 'delete' }, `Deleted "${feed.name}".`)) onGone?.()
  }

  async function leave() {
    if (!me || !window.confirm(`Leave "${feed.name}"? The lists you added leave with you.`)) return
    if (await api.change(feed, { action: 'members/remove', body: { memberId: me.id } }, `You left "${feed.name}".`)) {
      onGone?.()
    }
  }

  async function unfollow() {
    if (!window.confirm(`Stop following "${feed.name}"? Its links keep the titles they have, but stop updating.`)) return
    if (await api.unfollow(feed)) onGone?.()
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost-muted" size="icon" aria-label={`More for ${feed.name}`} disabled={api.busy}>
          <EllipsisIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {feed.kind === 'shared' && feed.owner && (
          <>
            <DropdownMenuItem onSelect={rename}>
              <PencilIcon />
              Rename
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => void remove()}>
              <Trash2Icon />
              Delete feed
            </DropdownMenuItem>
          </>
        )}
        {feed.kind === 'shared' && !feed.owner && (
          <DropdownMenuItem variant="destructive" onSelect={() => void leave()}>
            <LogOutIcon />
            Leave
          </DropdownMenuItem>
        )}
        {feed.kind === 'single' && (
          <DropdownMenuItem variant="destructive" onSelect={() => void unfollow()}>
            <XIcon />
            Stop following
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// ── Its IMDb lists ───────────────────────────────────────────────────────────

/** One IMDb list in a feed: who added it, how big, how it is doing. */
export function SourceRow({ feed, source, api }: { feed: Feed; source: SharedSource; api: FeedsApi }) {
  const title = source.listTitle || 'IMDb list'
  const who = source.yours ? 'You' : (source.addedBy ?? 'Someone')
  const health: Health = source.status === 'ready' ? 'ready' : source.status === 'error' ? 'error' : 'pending'

  function remove() {
    if (!window.confirm(`Take "${title}" out of "${feed.name}"?`)) return
    void api.change(feed, { action: 'sources/remove', body: { feedSlug: source.slug } }, `Took "${title}" out.`)
  }

  return (
    <li className="group/row flex items-center gap-3 py-2.5">
      {feed.kind === 'shared' && (
        <Avatar
          name={source.yours ? (feed.members.find((member) => member.you)?.name ?? 'You') : who}
          you={source.yours}
          className="size-7 text-xs"
        />
      )}
      <div className="min-w-0 flex-1">
        <a
          href={source.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="hover:text-ink block truncate text-sm font-medium underline-offset-2 hover:underline"
        >
          {title}
        </a>
        <p className="text-muted-foreground truncate text-xs">
          {feed.kind === 'shared' && `${who} · `}
          {source.itemCount} title{source.itemCount === 1 ? '' : 's'}
          {source.lastSyncedAt ? ` · read ${formatRelativeTime(source.lastSyncedAt)}` : ''}
        </p>
        {source.status === 'error' && source.lastError && <p className="text-destructive mt-0.5 text-xs">{source.lastError}</p>}
      </div>
      <HealthDot health={health} label="" className="shrink-0" />
      {/* Every row keeps the remove button's room, so the dots line up whoever may remove what. */}
      {feed.kind === 'shared' &&
        (source.removable ? (
          <Button
            type="button"
            variant="ghost-destructive-muted"
            size="icon"
            className="size-7 opacity-100 transition-opacity sm:opacity-0 sm:group-hover/row:opacity-100 sm:focus-visible:opacity-100"
            onClick={remove}
            aria-label={`Take ${title} out`}
            disabled={api.busy}
          >
            <XIcon className="size-3.5" />
          </Button>
        ) : (
          <span className="size-7 shrink-0" aria-hidden="true" />
        ))}
    </li>
  )
}

/** "Add a list" that opens into a field only when asked for. */
export function AddSource({ feed, api }: { feed: Feed; api: FeedsApi }) {
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState('')
  const trimmed = url.trim()
  const valid = trimmed.length === 0 || isSupportedImdbUrl(trimmed)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!trimmed || !valid) return
    const done = await api.change(feed, { action: 'sources', body: { sourceUrl: trimmed } }, 'Added. Its titles join within a few minutes.')
    if (done) {
      setUrl('')
      setOpen(false)
    }
  }

  if (!open) {
    return (
      <Button type="button" variant="ghost" size="sm" className="text-muted-foreground -ms-2" onClick={() => setOpen(true)}>
        <PlusIcon />
        Add an IMDb list
      </Button>
    )
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 pt-1 sm:flex-row motion-safe:animate-rise">
      <Input
        autoFocus
        type="url"
        inputMode="url"
        spellCheck={false}
        placeholder="Paste a public IMDb list or watchlist link"
        value={url}
        onChange={(event) => setUrl(event.target.value)}
        aria-invalid={!valid}
        aria-label="IMDb list or watchlist link"
        className="h-9"
      />
      <div className="flex gap-2">
        <Button type="submit" variant="cta" className="h-9 px-4" disabled={api.busy || !trimmed || !valid}>
          Add
        </Button>
        <Button type="button" variant="ghost" className="h-9" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

// ── Its people ───────────────────────────────────────────────────────────────

export function PeopleList({ feed, api }: { feed: Feed; api: FeedsApi }) {
  function remove(member: SharedMember) {
    const name = member.name ?? 'this person'
    if (!window.confirm(`Remove ${name} from "${feed.name}"? The lists they added go with them.`)) return
    void api.change(feed, { action: 'members/remove', body: { memberId: member.id } }, `Removed ${name}.`)
  }

  return (
    <ul className="divide-y">
      {feed.members.map((member) => (
        <li key={member.id} className="flex items-center gap-3 py-2.5">
          <Avatar name={member.name} you={member.you} />
          <span className="min-w-0 flex-1 truncate text-sm font-medium">
            {member.name ?? 'Someone'}
            {member.you && <span className="text-muted-foreground font-normal"> (you)</span>}
          </span>
          <span className="text-muted-foreground text-xs">{member.owner ? 'Made this feed' : 'Adds lists'}</span>
          {feed.owner && !member.you && (
            <Button
              type="button"
              variant="ghost-destructive-muted"
              size="icon"
              className="size-7"
              onClick={() => remove(member)}
              aria-label={`Remove ${member.name ?? 'this person'}`}
              disabled={api.busy}
            >
              <XIcon className="size-3.5" />
            </Button>
          )}
        </li>
      ))}
    </ul>
  )
}

/** The join link, for the person who made the feed: copy it, or make a new one. */
export function InviteLink({ feed, api }: { feed: Feed; api: FeedsApi }) {
  const [copied, setCopied] = useState(false)
  if (!feed.inviteUrl) {
    return (
      <p className="text-muted-foreground text-sm">
        Only {feed.ownerName ?? 'the person who made it'} can invite people to this feed.
      </p>
    )
  }
  const url = feed.inviteUrl

  async function copy() {
    try {
      await writeToClipboard(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
      void notify('success', 'Join link copied.')
    } catch {
      void notify('error', 'Could not copy the join link.')
    }
  }

  function reset() {
    if (!window.confirm('Make a new join link? The old one stops working. Everyone already in stays in.')) return
    void api.change(feed, { action: 'invite' }, 'New join link made.')
  }

  return (
    <div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <p className="bg-background/60 ring-foreground/10 min-w-0 flex-1 truncate rounded-md px-3 py-2 font-mono text-xs ring-1" title={url}>
          {url}
        </p>
        <Button type="button" variant="cta" onClick={copy} className="shrink-0">
          {copied ? <CheckIcon /> : <LinkIcon />}
          {copied ? 'Copied' : 'Copy join link'}
        </Button>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground text-xs text-pretty">
          Whoever opens it and signs in can add their own IMDb lists.
        </p>
        <Button type="button" variant="ghost" size="sm" onClick={reset} disabled={api.busy}>
          <RefreshCwIcon />
          New link
        </Button>
      </div>
    </div>
  )
}

// ── A new feed ───────────────────────────────────────────────────────────────

/**
 * Paste a link and it is a feed. "Add another list" makes it one feed for
 * several lists, and only then asks for a name.
 */
export function NewFeedForm({
  api,
  defaultName,
  onMade,
  onCancel,
  footer,
}: {
  api: FeedsApi
  defaultName: string
  onMade: (key: string) => void
  onCancel?: () => void
  footer?: ReactNode
}) {
  const [links, setLinks] = useState([''])
  const [name, setName] = useState('')
  const filled = links.map((link) => link.trim()).filter(Boolean)
  const invalid = filled.some((link) => !isSupportedImdbUrl(link))
  const several = links.length > 1

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (filled.length === 0 || invalid) return
    const key = await api.create(filled, name.trim() || defaultName)
    if (key) onMade(key)
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="new-feed-link-0">{several ? 'IMDb lists for this feed' : 'IMDb list or watchlist'}</Label>
        {links.map((link, index) => (
          <div key={index} className="relative">
            <Input
              id={`new-feed-link-${index}`}
              autoFocus={index === links.length - 1}
              type="url"
              inputMode="url"
              spellCheck={false}
              placeholder={index === 0 ? 'Paste a public IMDb list or watchlist link' : 'Another IMDb list or watchlist link'}
              value={link}
              onChange={(event) => setLinks((current) => current.map((value, at) => (at === index ? event.target.value : value)))}
              aria-invalid={link.trim().length > 0 && !isSupportedImdbUrl(link.trim())}
              className={cn('h-10', several && 'pe-10')}
            />
            {several && (
              <button
                type="button"
                onClick={() => setLinks((current) => current.filter((_, at) => at !== index))}
                aria-label={`Remove link ${index + 1}`}
                className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 flex size-7 -translate-y-1/2 items-center justify-center rounded-full"
              >
                <XIcon className="size-4" />
              </button>
            )}
          </div>
        ))}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button type="button" variant="ghost" size="sm" className="text-muted-foreground -ms-2" onClick={() => setLinks((current) => [...current, ''])}>
            <PlusIcon />
            Add another list
          </Button>
          {invalid && <span className="text-destructive text-xs">One of these is not an IMDb list or watchlist link.</span>}
        </div>
      </div>

      {several && (
        <div className="grid gap-2 motion-safe:animate-rise">
          <Label htmlFor="new-feed-name">Name</Label>
          <Input
            id="new-feed-name"
            maxLength={60}
            placeholder={defaultName}
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="h-10"
          />
          <p className="text-muted-foreground text-xs">
            One Radarr link and one Sonarr link for all of them. You can invite people to add theirs later.
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2">
        {footer}
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" variant="cta" size="cta" disabled={api.busy || filled.length === 0 || invalid}>
          {several ? `Make one feed from ${filled.length || links.length}` : 'Make feed'}
        </Button>
      </div>
    </form>
  )
}
