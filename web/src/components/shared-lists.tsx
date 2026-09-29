import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { ClockIcon, CrownIcon, LogOutIcon, PencilIcon, PlusIcon, RefreshCwIcon, Trash2Icon, XIcon } from 'lucide-react'

import { CopyField } from '@/components/copy-field'
import { Panel, TargetCards } from '@/components/feed-card'
import { FeedHealthBadge } from '@/components/feed-health-badge'
import { SectionTitle } from '@/components/site-chrome'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  changeSharedList,
  createSharedList,
  isSupportedImdbUrl,
  readSharedLists,
  type SharedList,
  type SharedMember,
  type SharedSource,
} from '@/lib/api'
import { scrollBehavior } from '@/lib/motion'
import { notify } from '@/lib/notify'
import { formatRelativeTime } from '@/lib/relative-time'

// A list just added is read from IMDb within a few minutes; until every list
// in view has been read once, the section asks again at this pace.
const POLL_WHILE_WAITING_MS = 30_000

/** Runs one change and swaps in the lists it answers with; true when it worked. */
type RunChange = (change: () => Promise<{ lists: SharedList[] }>, done?: string) => Promise<boolean>

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

function personName(member: Pick<SharedMember, 'name' | 'you'>) {
  if (member.you) return 'You'
  return member.name ?? 'Someone'
}

function SubHeading({ children }: { children: ReactNode }) {
  return <h4 className="mt-7 mb-2 text-sm font-bold">{children}</h4>
}

function SourceRow({ source, onRemove }: { source: SharedSource; onRemove: (source: SharedSource) => void }) {
  const label = source.listTitle || source.sourceUrl
  const addedBy = source.yours ? 'you' : (source.addedBy ?? 'someone')
  return (
    <li className="flex flex-col gap-2 border-b py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <a
          href={source.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="hover:text-ink block truncate text-sm font-medium underline-offset-2 hover:underline"
        >
          {label}
        </a>
        <p className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-1 text-xs">
          <ClockIcon className="size-3" />
          Added by {addedBy} · {source.lastSyncedAt ? `read ${formatRelativeTime(source.lastSyncedAt)}` : 'not read yet'} ·{' '}
          {plural(source.itemCount, 'title')}
        </p>
        {source.status === 'error' && source.lastError && <p className="text-destructive mt-1 text-xs">{source.lastError}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <FeedHealthBadge feed={source} />
        {source.removable && (
          <Button
            type="button"
            size="sm"
            variant="ghost-destructive-muted"
            onClick={() => onRemove(source)}
            aria-label={`Take ${label} out of this shared list`}
          >
            <XIcon className="size-3.5" />
            Remove
          </Button>
        )}
      </div>
    </li>
  )
}

function AddSourceForm({ list, busy, run }: { list: SharedList; busy: boolean; run: RunChange }) {
  const [sourceUrl, setSourceUrl] = useState('')
  const trimmed = sourceUrl.trim()
  const looksValid = trimmed.length === 0 || isSupportedImdbUrl(trimmed)
  const fieldId = `add-source-${list.slug}`

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || !trimmed || !looksValid) return
    const added = await run(
      () => changeSharedList(list.slug, { action: 'sources', body: { sourceUrl: trimmed } }),
      'Added. Its titles join the links within a few minutes.',
    )
    if (added) setSourceUrl('')
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4">
      <Label htmlFor={fieldId} className="mb-2 block">
        Add an IMDb watchlist or list
      </Label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          id={fieldId}
          type="url"
          inputMode="url"
          spellCheck={false}
          placeholder="Paste a public IMDb list or watchlist link"
          value={sourceUrl}
          onChange={(event) => setSourceUrl(event.target.value)}
          aria-invalid={!looksValid}
          className="h-10"
        />
        <Button type="submit" variant="cta" className="h-10 px-4" disabled={busy || !trimmed || !looksValid}>
          <PlusIcon className="size-4" />
          Add
        </Button>
      </div>
      {!looksValid && (
        <p className="text-destructive mt-1.5 text-xs">That is not an IMDb list or watchlist link.</p>
      )}
    </form>
  )
}

function People({ list, onRemove }: { list: SharedList; onRemove: (member: SharedMember) => void }) {
  return (
    <ul className="flex flex-wrap gap-2">
      {list.members.map((member) => (
        <li
          key={member.id}
          className="bg-secondary ring-foreground/10 flex h-8 items-center gap-1.5 rounded-full ps-3 pe-1.5 text-sm ring-1"
        >
          {member.owner && <CrownIcon className="text-ink size-3.5" aria-label="Made this shared list" />}
          <span className={member.owner || !list.owner || member.you ? 'pe-1.5' : ''}>{personName(member)}</span>
          {list.owner && !member.you && (
            <Button
              type="button"
              size="icon"
              variant="ghost-destructive-muted"
              className="size-6 rounded-full"
              onClick={() => onRemove(member)}
              aria-label={`Remove ${personName(member)} and the lists they added`}
            >
              <XIcon className="size-3.5" />
            </Button>
          )}
        </li>
      ))}
    </ul>
  )
}

function SharedListCard({ list, busy, run }: { list: SharedList; busy: boolean; run: RunChange }) {
  const maker = list.members.find((member) => member.owner)
  const me = list.members.find((member) => member.you)
  const change = (action: Parameters<typeof changeSharedList>[1], done?: string) =>
    run(() => changeSharedList(list.slug, action), done)

  function removeSource(source: SharedSource) {
    const label = source.listTitle || source.sourceUrl
    if (!window.confirm(`Take "${label}" out of "${list.name}"? Its titles leave the shared links.`)) return
    void change({ action: 'sources/remove', body: { feedSlug: source.slug } }, `Took "${label}" out.`)
  }

  function removeMember(member: SharedMember) {
    const name = personName(member)
    if (!window.confirm(`Remove ${name} from "${list.name}"? The lists they added go with them.`)) return
    void change({ action: 'members/remove', body: { memberId: member.id } }, `Removed ${name}.`)
  }

  function leave() {
    if (!me || !window.confirm(`Leave "${list.name}"? The lists you added leave with you.`)) return
    void change({ action: 'members/remove', body: { memberId: me.id } }, `You left "${list.name}".`)
  }

  function rename() {
    const name = window.prompt('A new name for this shared list', list.name)?.trim()
    if (!name || name === list.name) return
    void change({ action: 'rename', body: { name } }, 'Renamed.')
  }

  function resetInvite() {
    if (!window.confirm('Make a new join link? The old one stops working. Everyone already in stays in.')) return
    void change({ action: 'invite' }, 'New join link made.')
  }

  function remove() {
    if (!window.confirm(`Delete "${list.name}"? Its Radarr and Sonarr links stop working for everyone.`)) return
    void change({ action: 'delete' }, `Deleted "${list.name}".`)
  }

  const madeBy = list.owner ? 'You made this' : `Made by ${maker?.name ?? 'someone'}`
  return (
    <Panel>
      <div id={`shared-${list.slug}`} className="flex scroll-mt-24 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className="truncate text-xl font-bold">{list.name}</h3>
          <p className="text-muted-foreground mt-1 text-sm">
            {madeBy} · {plural(list.movieCount, 'movie')} · {plural(list.showCount, 'show')} from{' '}
            {plural(list.sources.length, 'IMDb list')}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {list.owner ? (
            <>
              <Button type="button" size="sm" variant="ghost" onClick={rename} disabled={busy}>
                <PencilIcon className="size-3.5" />
                Rename
              </Button>
              <Button type="button" size="sm" variant="ghost-destructive-muted" onClick={remove} disabled={busy}>
                <Trash2Icon className="size-3.5" />
                Delete
              </Button>
            </>
          ) : (
            <Button type="button" size="sm" variant="ghost-destructive-muted" onClick={leave} disabled={busy}>
              <LogOutIcon className="size-3.5" />
              Leave
            </Button>
          )}
        </div>
      </div>

      <div className="mt-5">
        <TargetCards
          link={(target) => (
            <CopyField value={target.app === 'Radarr' ? list.radarrUrl : list.sonarrUrl} label={target.label} />
          )}
        />
      </div>

      <SubHeading>IMDb lists in it</SubHeading>
      {list.sources.length > 0 ? (
        <ul className="bg-background/40 ring-foreground/10 rounded-lg px-4 ring-1">
          {list.sources.map((source) => (
            <SourceRow key={source.slug} source={source} onRemove={removeSource} />
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-sm">
          None yet. Add yours below{list.owner ? ', then send the others the join link' : ''}.
        </p>
      )}
      <AddSourceForm list={list} busy={busy} run={run} />

      <SubHeading>People</SubHeading>
      <People list={list} onRemove={removeMember} />

      {list.inviteUrl && (
        <>
          <SubHeading>Join link</SubHeading>
          <CopyField value={list.inviteUrl} label="Join link" />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-muted-foreground text-xs text-pretty">
              Anyone who opens it and signs in can add their IMDb lists. Only send it to people you know.
            </p>
            <Button type="button" size="sm" variant="ghost" onClick={resetInvite} disabled={busy}>
              <RefreshCwIcon className="size-3.5" />
              New link
            </Button>
          </div>
        </>
      )}
    </Panel>
  )
}

function CreateSharedList({
  busy,
  run,
  first,
  onMade,
}: {
  busy: boolean
  run: RunChange
  first: boolean
  onMade: (slug: string) => void
}) {
  const [name, setName] = useState('')
  const trimmed = name.trim()

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || !trimmed) return
    const made = await run(async () => {
      const result = await createSharedList(trimmed)
      if (result.slug) onMade(result.slug)
      return result
    }, `Made "${trimmed}". Add an IMDb list to it, then send the join link.`)
    if (made) setName('')
  }

  return (
    <form onSubmit={handleSubmit}>
      <Label htmlFor="shared-list-name" className="mb-2 block">
        {first ? 'Name it' : 'Make another shared list'}
      </Label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          id="shared-list-name"
          maxLength={60}
          placeholder="Like: Our house"
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="h-10"
        />
        <Button type="submit" variant="cta" className="h-10 px-4" disabled={busy || !trimmed}>
          <PlusIcon className="size-4" />
          Make a shared list
        </Button>
      </div>
    </form>
  )
}

/**
 * Shared lists, for a signed-in visitor: one Radarr link and one Sonarr link
 * that several IMDb lists feed, each title once. The person who makes one hands
 * out its join link, and everyone who joins adds their own lists. `refreshKey`
 * changes when the page joins one, so the section reads again and scrolls to it.
 */
export function SharedLists({ refreshKey = '', focusSlug = null }: { refreshKey?: string; focusSlug?: string | null }) {
  const [lists, setLists] = useState<SharedList[] | null>(null)
  const [busy, setBusy] = useState(false)
  // The card to bring into view once it is on screen: one just made, or just joined.
  const scrollTo = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false
    readSharedLists().then(
      (value) => {
        if (cancelled) return
        scrollTo.current = focusSlug
        setLists(value)
      },
      () => {
        if (!cancelled) setLists([])
      },
    )
    return () => {
      cancelled = true
    }
  }, [refreshKey, focusSlug])

  useEffect(() => {
    if (!lists || !scrollTo.current) return
    document.getElementById(`shared-${scrollTo.current}`)?.scrollIntoView({ block: 'start', behavior: scrollBehavior() })
    scrollTo.current = null
  }, [lists])

  // A list nobody has read yet fills in on the next sync run; keep the counts honest until it does.
  const waiting = Boolean(lists?.some((list) => list.sources.some((source) => !source.lastSyncedAt)))
  useEffect(() => {
    if (!waiting) return
    const timer = setInterval(() => {
      readSharedLists().then(setLists, () => {
        // The next tick tries again; what is on screen is only a little old.
      })
    }, POLL_WHILE_WAITING_MS)
    return () => clearInterval(timer)
  }, [waiting])

  const run: RunChange = async (change, done) => {
    setBusy(true)
    try {
      setLists((await change()).lists)
      if (done) void notify('success', done)
      return true
    } catch (error) {
      void notify('error', error instanceof Error ? error.message : 'That did not work. Try again.')
      return false
    } finally {
      setBusy(false)
    }
  }

  if (!lists) return null

  return (
    <section id="shared-lists" className="mt-12 scroll-mt-20" aria-labelledby="shared-lists-title">
      <SectionTitle id="shared-lists-title">Shared lists</SectionTitle>
      <p className="text-muted-foreground -mt-2 mb-4 max-w-2xl text-sm text-pretty">
        One Radarr link and one Sonarr link for the whole house. Add as many IMDb lists as you like, and send the
        join link so family or friends can add theirs. A title on two lists is added once.
      </p>
      <div className="grid gap-4">
        {lists.map((list) => (
          <SharedListCard key={list.slug} list={list} busy={busy} run={run} />
        ))}
        <div className="bg-card ring-foreground/10 rounded-lg p-5 ring-1 sm:p-6">
          <CreateSharedList
            busy={busy}
            run={run}
            first={lists.length === 0}
            onMade={(slug) => {
              scrollTo.current = slug
            }}
          />
        </div>
      </div>
    </section>
  )
}
