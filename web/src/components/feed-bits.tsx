// The pieces the library (library.tsx) is built from: a feed's cover, who is
// in it, how it is doing, its two copy buttons, its lists, its people, and the
// form that makes a new one. Each shows the little it must, and opens for more.
import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CopyIcon,
  EllipsisIcon,
  ExternalLinkIcon,
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
import { useAsk } from '@/lib/ask'
import { writeToClipboard } from '@/lib/clipboard'
import { EXAMPLE_LISTS } from '@/lib/example-lists'
import { prefersReducedMotion } from '@/lib/motion'
import { notify } from '@/lib/notify'
import { formatRelativeTime } from '@/lib/relative-time'
import { cn } from '@/lib/utils'
import { peopleIn, type Feed, type FeedsApi, type Health } from '@/lib/use-feeds'

// ── Folding ──────────────────────────────────────────────────────────────────

/**
 * A part that folds open and shut (index.css's fold), out of reach of the
 * keyboard while shut. The inner bleed keeps focus rings from being clipped.
 */
export function Fold({ open, id, className, children }: { open: boolean; id?: string; className?: string; children: ReactNode }) {
  return (
    <div id={id} className={cn('fold', className)} data-folded={open ? undefined : ''} inert={!open}>
      <div className="-m-1 p-1">{children}</div>
    </div>
  )
}

/** How long a fold takes to shut, so a row can fold away before it is gone. */
function afterFolding(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, prefersReducedMotion() ? 0 : 320))
}

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
    <span className={cn('flex items-center -space-x-1.5', className)} aria-label={peopleIn(members.length)}>
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

/** Mark a cover loaded, so it fades in over its tile instead of popping in line by line. */
function markLoaded(image: HTMLImageElement | null) {
  if (image?.complete && image.naturalWidth > 0) image.dataset.loaded = ''
}

/**
 * The same cover at about the width it is drawn, for a sharp screen: IMDb's
 * image host scales on request (src/imdb.js asks for 380 pixels, a whole
 * poster's worth), and a 20-pixel tile does not need that.
 */
function sized(poster: string, drawnWidth: number): string {
  const width = Math.min(380, Math.ceil((drawnWidth * 2) / 20) * 20)
  return poster.replace(/_UX\d+_/, `_UX${width}_`)
}

/**
 * A cover image, `width` CSS pixels wide, that fades in once it has arrived.
 * `lazy` for one that may start off screen; a feed's own cover is always in
 * view and small, and the browser holds lazy images back for seconds.
 */
export function CoverImage({ src, width, lazy = false, className }: { src: string; width: number; lazy?: boolean; className?: string }) {
  return (
    <img
      ref={markLoaded}
      src={sized(src, width)}
      alt=""
      loading={lazy ? 'lazy' : 'eager'}
      decoding="async"
      onLoad={(event) => markLoaded(event.currentTarget)}
      className={cn(
        'size-full object-cover opacity-0 transition-opacity duration-500 ease-(--ease-soft) data-loaded:opacity-100 motion-reduce:transition-none',
        className,
      )}
    />
  )
}

/**
 * A feed's cover, the way a playlist has one: four of its covers in a square,
 * or one when it has fewer, or a film mark while none are read yet. `size` is
 * how wide it is drawn, in CSS pixels, so each cover is fetched at that size.
 */
export function CoverMosaic({ posters, size, className }: { posters: string[]; size: number; className: string }) {
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
        <CoverImage key={poster} src={poster} width={tiles.length === 4 ? size / 2 : size} />
      ))}
    </span>
  )
}

// ── Status ───────────────────────────────────────────────────────────────────

const HEALTH = {
  ready: { dot: 'bg-emerald-500', label: 'Up to date' },
  pending: { dot: 'bg-amber-400 text-amber-400 breathe', label: 'Reading from IMDb' },
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

/** "Radarr" with a copy mark: the link is what gets copied, not shown. It says Copied, and a big one flashes. */
export function CopyAppButton({
  app,
  url,
  variant = 'secondary',
  size = 'sm',
  className,
  onUse,
}: {
  app: App
  url: string
  variant?: 'secondary' | 'cta'
  size?: 'sm' | 'default' | 'cta'
  className?: string
  /** After it is pressed, copied or not: the library opens where the link goes, with the link to copy by hand. */
  onUse?: () => void
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
      void notify('error', 'Could not copy. The link is under “Where do these go in Radarr and Sonarr?” to copy by hand.')
    }
    onUse?.()
  }

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      onClick={copy}
      className={cn(copied && variant === 'cta' && 'sweep-once', className)}
      title={url}
      aria-label={`Copy the ${app} link`}
    >
      {/* Both faces in one cell, the hidden one keeping the width: the buttons beside it never move. */}
      <span className="grid gap-[inherit] *:col-start-1 *:row-start-1 *:flex *:items-center *:justify-center *:gap-[inherit]">
        <span className={cn(copied && 'invisible')}>
          <Icon />
          {app}
          <CopyIcon className="opacity-60" />
        </span>
        <span className={cn(!copied && 'invisible')} aria-hidden={!copied}>
          {copied && <CheckIcon className="motion-safe:animate-pop" />}
          Copied
        </span>
      </span>
    </Button>
  )
}

/** Where each link goes in its app, with the link itself for anyone who wants to see it. */
export function SetupSteps({ feed }: { feed: Feed }) {
  return (
    // minmax(0, 1fr): the link, one unbroken line, would otherwise stretch the column past a phone's screen.
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-2">
      {(Object.keys(APPS) as App[]).map((app) => {
        const url = app === 'Radarr' ? feed.radarrUrl : feed.sonarrUrl
        const Icon = APPS[app].icon
        return (
          <div key={app} className="bg-background/60 ring-foreground/10 min-w-0 rounded-lg p-4 ring-1">
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
              <span className="text-muted-foreground text-xs text-pretty">Paste it as the Full URL. Any API key works.</span>
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
export function FeedMenu({
  feed,
  api,
  onRename,
  onGone,
}: {
  feed: Feed
  api: FeedsApi
  /** Turn the feed's name into a field, where it is. */
  onRename?: () => void
  onGone?: () => void
}) {
  const ask = useAsk()
  const me = feed.members.find((member) => member.you)
  // Something chosen here moves the focus on (the name's field, a question), so the menu does not take it back.
  const chosen = useRef(false)
  const trigger = useRef<HTMLButtonElement>(null)
  // After a question: back to the ⋯, or, the feed gone, to the name of the one on screen now.
  const returnFocus = () => trigger.current ?? document.getElementById('feed-title') ?? document.getElementById('first-feed-title')

  function choose(action: () => void) {
    chosen.current = true
    action()
  }

  async function remove() {
    const yes = await ask({
      title: `Delete “${feed.name}”?`,
      body: 'Its Radarr and Sonarr links stop working, for everyone in it. The IMDb lists themselves are not touched.',
      yes: 'Delete feed',
      returnFocus,
    })
    if (yes && (await api.change(feed, { action: 'delete' }, `Deleted “${feed.name}”.`))) onGone?.()
  }

  async function leave() {
    if (!me) return
    const yes = await ask({
      title: `Leave “${feed.name}”?`,
      body: 'The IMDb lists you added leave with you. You can come back with its join link.',
      yes: 'Leave',
      returnFocus,
    })
    if (yes && (await api.change(feed, { action: 'members/remove', body: { memberId: me.id } }, `You left “${feed.name}”.`))) {
      onGone?.()
    }
  }

  async function unfollow() {
    const yes = await ask({
      title: `Stop following “${feed.name}”?`,
      body: 'Its links keep the titles they have now, but stop picking up new ones from IMDb.',
      yes: 'Stop following',
      returnFocus,
    })
    if (yes && (await api.unfollow(feed))) onGone?.()
  }

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button ref={trigger} type="button" variant="ghost-muted" size="icon" aria-label={`More for ${feed.name}`} disabled={api.busy}>
          <EllipsisIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        onCloseAutoFocus={(event) => {
          if (!chosen.current) return
          event.preventDefault()
          chosen.current = false
        }}
      >
        {feed.kind === 'shared' && feed.owner && (
          <>
            {onRename && (
              <DropdownMenuItem onSelect={() => choose(onRename)}>
                <PencilIcon />
                Rename
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => choose(() => void remove())}>
              <Trash2Icon />
              Delete feed
            </DropdownMenuItem>
          </>
        )}
        {feed.kind === 'shared' && !feed.owner && (
          <DropdownMenuItem variant="destructive" onSelect={() => choose(() => void leave())}>
            <LogOutIcon />
            Leave
          </DropdownMenuItem>
        )}
        {feed.kind === 'single' && (
          <DropdownMenuItem variant="destructive" onSelect={() => choose(() => void unfollow())}>
            <XIcon />
            Stop following
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** The feed's name as a field: Enter or leaving it saves, Escape puts it back. */
export function RenameField({ feed, api, onDone, className }: { feed: Feed; api: FeedsApi; onDone: () => void; className?: string }) {
  const [name, setName] = useState(feed.name)
  const settled = useRef(false)

  function save(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault()
    if (settled.current) return
    settled.current = true
    const next = name.trim()
    if (next && next !== feed.name) void api.change(feed, { action: 'rename', body: { name: next } }, 'Renamed.')
    onDone()
  }

  return (
    <form onSubmit={save} className="min-w-0">
      <Input
        autoFocus
        onFocus={(event) => event.currentTarget.select()}
        maxLength={60}
        value={name}
        onChange={(event) => setName(event.target.value)}
        onBlur={() => save()}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          settled.current = true
          onDone()
        }}
        aria-label="Feed name"
        className={className}
      />
    </form>
  )
}

// ── Its IMDb lists ───────────────────────────────────────────────────────────

/**
 * One IMDb list in a feed, as one line: whose, how big, how it is doing. It
 * opens for when it was read, what went wrong, and what can be done to it; a
 * list that cannot be read starts open, so the reason is already there.
 */
export function SourceRow({ feed, source, api }: { feed: Feed; source: SharedSource; api: FeedsApi }) {
  const ask = useAsk()
  const failing = source.status === 'error'
  const [open, setOpen] = useState(failing)
  const [leaving, setLeaving] = useState(false)
  const detailsId = useId()
  const row = useRef<HTMLButtonElement>(null)
  const leavingNow = useRef(false)
  const shared = feed.kind === 'shared'
  const title = source.listTitle || 'IMDb list'
  const who = source.yours ? 'You' : (source.addedBy ?? 'Someone')
  const health: Health = source.status === 'ready' ? 'ready' : failing ? 'error' : 'pending'
  const count = `${source.itemCount} title${source.itemCount === 1 ? '' : 's'}`

  async function takeOut() {
    const yes = await ask({
      title: `Take “${title}” out?`,
      body: `Its titles leave “${feed.name}” on the next read. The list stays on IMDb, and you can add it again.`,
      yes: 'Take it out',
      // The row, or once it has gone, the lists' heading.
      returnFocus: () => (row.current?.isConnected && !leavingNow.current ? row.current : document.getElementById('lists-title')),
    })
    if (!yes) return
    leavingNow.current = true
    setLeaving(true)
    await afterFolding()
    const done = await api.change(feed, { action: 'sources/remove', body: { feedSlug: source.slug } }, `Took “${title}” out.`)
    if (!done) {
      leavingNow.current = false
      setLeaving(false)
    }
  }

  return (
    <li className="fold" data-folded={leaving ? '' : undefined}>
      <div>
        <button
          ref={row}
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
          aria-controls={detailsId}
          className="hover:bg-muted/60 focus-visible:ring-ring/50 flex w-full min-w-0 items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-inset"
        >
          {shared && (
            <Avatar
              name={source.yours ? (feed.members.find((member) => member.you)?.name ?? 'You') : who}
              you={source.yours}
              className="size-7 text-xs"
            />
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{title}</span>
            <span className="text-muted-foreground block truncate text-xs">{shared ? `${who} · ${count}` : count}</span>
          </span>
          <HealthDot health={health} label="" className="shrink-0" />
          <ChevronDownIcon
            className={cn(
              'text-muted-foreground size-4 shrink-0 transition-transform duration-300 ease-(--ease-soft)',
              open && 'rotate-180',
            )}
            aria-hidden="true"
          />
        </button>
        <Fold open={open} id={detailsId}>
          <div className={cn('pe-2 pb-3', shared ? 'ps-12' : 'ps-2')}>
            <p className={cn('text-xs text-pretty', failing ? 'text-destructive' : 'text-muted-foreground')}>
              {failing
                ? (source.lastError ?? 'IMDb did not answer. We try again on every run.')
                : source.lastSyncedAt
                  ? `Read from IMDb ${formatRelativeTime(source.lastSyncedAt)}. We read it again every fifteen minutes or so.`
                  : 'Waiting for its first read from IMDb. It usually takes a few minutes.'}
            </p>
            <div className="mt-2 flex flex-wrap gap-1">
              <Button asChild variant="ghost" size="sm" className="-ms-2.5">
                <a href={source.sourceUrl} target="_blank" rel="noreferrer">
                  <ExternalLinkIcon />
                  Open on IMDb
                </a>
              </Button>
              {source.removable && (
                <Button type="button" variant="ghost-destructive-muted" size="sm" onClick={() => void takeOut()} disabled={api.busy}>
                  <XIcon />
                  Take it out
                </Button>
              )}
            </div>
          </div>
        </Fold>
      </div>
    </li>
  )
}

/** "Add an IMDb list" that folds open into a field only when asked for. */
export function AddSource({ feed, api, defaultOpen = false }: { feed: Feed; api: FeedsApi; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const [url, setUrl] = useState('')
  const field = useRef<HTMLInputElement>(null)
  const opener = useRef<HTMLButtonElement>(null)
  const trimmed = url.trim()
  const valid = trimmed.length === 0 || isSupportedImdbUrl(trimmed)

  function show() {
    setOpen(true)
    // After the fold is reachable again: the field is where they are about to paste.
    setTimeout(() => field.current?.focus(), 0)
  }

  function hide() {
    setOpen(false)
    setUrl('')
    // The field folds away under the keyboard; it goes back to the button that opened it.
    setTimeout(() => opener.current?.focus(), 0)
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!trimmed || !valid) return
    const done = await api.change(feed, { action: 'sources', body: { sourceUrl: trimmed } }, 'Added. Its titles join within a few minutes.')
    if (done) hide()
  }

  return (
    <div className="mt-1">
      <Fold open={!open}>
        <Button ref={opener} type="button" variant="ghost" size="sm" className="text-muted-foreground" onClick={show}>
          <PlusIcon />
          Add an IMDb list
        </Button>
      </Fold>
      <Fold open={open}>
        <form onSubmit={submit} className="flex flex-col gap-2 px-2 pt-1 sm:flex-row">
          <Input
            ref={field}
            type="url"
            inputMode="url"
            spellCheck={false}
            placeholder="Paste a public IMDb list or watchlist link"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            onKeyDown={(event) => event.key === 'Escape' && hide()}
            aria-invalid={!valid}
            aria-label="IMDb list or watchlist link"
            className="h-9"
          />
          <div className="flex gap-2">
            <Button type="submit" variant="cta" className="h-9 px-4" disabled={api.busy || !trimmed || !valid}>
              Add
            </Button>
            <Button type="button" variant="ghost" className="h-9" onClick={hide}>
              Cancel
            </Button>
          </div>
        </form>
      </Fold>
    </div>
  )
}

// ── Its people ───────────────────────────────────────────────────────────────

export function PeopleList({ feed, api }: { feed: Feed; api: FeedsApi }) {
  const ask = useAsk()

  async function remove(member: SharedMember) {
    const name = member.name ?? 'this person'
    const yes = await ask({
      title: `Remove ${name}?`,
      body: `The IMDb lists they added to “${feed.name}” go with them.`,
      yes: 'Remove',
    })
    if (yes) void api.change(feed, { action: 'members/remove', body: { memberId: member.id } }, `Removed ${name}.`)
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
              onClick={() => void remove(member)}
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
  const ask = useAsk()
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

  async function reset() {
    const yes = await ask({
      title: 'Make a new join link?',
      body: 'The old one stops working. Everyone already in stays in.',
      yes: 'Make a new link',
    })
    if (yes) void api.change(feed, { action: 'invite' }, 'New join link made.')
  }

  return (
    <div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <p className="bg-background/60 ring-foreground/10 min-w-0 flex-1 truncate rounded-md px-3 py-2 font-mono text-xs ring-1" title={url}>
          {url}
        </p>
        <Button type="button" variant="cta" onClick={copy} className={cn('shrink-0', copied && 'sweep-once')}>
          {copied ? <CheckIcon className="motion-safe:animate-pop" /> : <LinkIcon />}
          {copied ? 'Copied' : 'Copy join link'}
        </Button>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground text-xs text-pretty">Whoever opens it and signs in can add their own IMDb lists.</p>
        <Button type="button" variant="ghost" size="sm" className="-me-2.5" onClick={() => void reset()} disabled={api.busy}>
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
 * several lists, and only then asks for a name. With nothing pasted yet, it
 * offers a few real lists to try.
 */
export function NewFeedForm({
  api,
  defaultName,
  initialLinks,
  onMade,
  onCancel,
}: {
  api: FeedsApi
  defaultName: string
  /** Links to start from: one someone sent, or the lists a visitor signed in to combine. */
  initialLinks?: string[]
  onMade: (key: string) => void
  onCancel?: () => void
}) {
  const [links, setLinks] = useState(initialLinks?.length ? initialLinks : [''])
  const [name, setName] = useState('')
  const firstField = useRef<HTMLInputElement>(null)
  const filled = links.map((link) => link.trim()).filter(Boolean)
  const invalid = filled.some((link) => !isSupportedImdbUrl(link))
  const several = links.length > 1
  const empty = filled.length === 0

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (empty || invalid) return
    const key = await api.create(filled, name.trim() || defaultName)
    if (key) onMade(key)
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="new-feed-link-0">{several ? 'IMDb lists for this feed' : 'IMDb list or watchlist'}</Label>
        {links.map((link, index) => (
          // The rows only ever grow at the end or lose one; the index is the row.
          <Fold key={index} open>
            <div className="relative">
              <Input
                ref={index === 0 ? firstField : undefined}
                id={`new-feed-link-${index}`}
                autoFocus={index === links.length - 1 && !link}
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
          </Fold>
        ))}
        <Fold open={empty && !several}>
          <p className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-xs">
            <span className="me-0.5">No link to hand? Try</span>
            {EXAMPLE_LISTS.slice(0, 3).map((example) => (
              <button
                key={example.url}
                type="button"
                title={example.url}
                onClick={() => {
                  setLinks([example.url])
                  // These fold away once the field is filled; the keyboard goes to the field.
                  setTimeout(() => firstField.current?.focus(), 0)
                }}
                className="bg-secondary hover:bg-muted text-foreground rounded-full px-2.5 py-1 font-medium transition-colors"
              >
                {example.name}
              </button>
            ))}
          </p>
        </Fold>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button type="button" variant="ghost" size="sm" className="text-muted-foreground -ms-2" onClick={() => setLinks((current) => [...current, ''])}>
            <PlusIcon />
            Add another list
          </Button>
          {invalid && <span className="text-destructive text-xs">One of these is not an IMDb list or watchlist link.</span>}
        </div>
      </div>

      <Fold open={several}>
        <div className="grid gap-2">
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
      </Fold>

      <div className="flex flex-wrap items-center justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="ghost" size="cta" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" variant="cta" size="cta" disabled={api.busy || empty || invalid}>
          {filled.length > 1 ? `Make one feed from ${filled.length}` : 'Make feed'}
        </Button>
      </div>
    </form>
  )
}
