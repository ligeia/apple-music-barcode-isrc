// ==UserScript==
// @name          Apple Music Barcodes/ISRCs
// @namespace     applemusic.barcode.isrc
// @description   Get Barcodes/ISRCs/etc. from Apple Music pages
// @version       0.30
// @match         https://music.apple.com/*
// @exclude-match https://music.apple.com/includes/commerce/fetch-proxy.html
// @run-at        document-idle
// @grant         GM_xmlhttpRequest
// ==/UserScript==

(async () => {
  // ======================== CONFIGURATION ========================
  // Modify these base URLs to match your setup.
  // Harmony: The base URL for Harmony release lookups.
  const HARMONY_BASE = 'http://localhost:5220/release'
  // MagicISRC: The base URL for kepstin's MagicISRC tool.
  const MAGIC_ISRC_BASE = 'https://magicisrc.kepstin.ca/'
  // MusicBrainz: The base URL for MusicBrainz (website and API).
  const MB_SITE = 'https://musicbrainz.org'
  // ===============================================================

  // for userscript managers that don't support @exclude-match
  if (document.location.pathname === '/includes/commerce/fetch-proxy.html') {
    return
  }

  async function fetchWrapper(url, options) {
    if (window.GM_xmlhttpRequest) {
      return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          ...options,
          url,
          onload(e) { resolve(e.response) },
          onerror(e) { reject(e) },
        })
      })
    } else {
      const res = await fetch(url, options)
      return await res.text()
    }
  }

  let scriptToken
  try {
    const configScript = document.querySelector('script[crossorigin]')
    const scriptSrc = await fetchWrapper(configScript.src)
    scriptToken = scriptSrc.match(/("|')(ey.*?)\1/)[2]
  } catch (e) {
    alert(`error getting apple music token: ${e}`)
    return
  }

  const token = scriptToken
  const baseURL = 'https://amp-api.music.apple.com/v1'
  const MB_BASE = `${MB_SITE}/ws/2`
  const MB_USER_AGENT = 'AppleMusicBarcodeISRC-Userscript/0.30 (https://github.com/)'
  const MBID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

  async function searchMBByBarcode(barcode) {
    try {
      const url = `${MB_BASE}/release/?query=barcode:${barcode}&fmt=json`
      const res = await fetchWrapper(url, {
        method: 'GET',
        headers: { 'User-Agent': MB_USER_AGENT }
      })
      const data = JSON.parse(res)
      if (data.releases && data.releases.length > 0) {
        return data.releases[0] // Return first match
      }
      return null
    } catch (e) {
      console.error('MusicBrainz search error:', e)
      return null
    }
  }

  async function fetchMBRelease(mbid) {
    try {
      const url = `${MB_BASE}/release/${mbid}?inc=recordings+isrcs+labels+artist-credits&fmt=json`
      const res = await fetchWrapper(url, {
        method: 'GET',
        headers: { 'User-Agent': MB_USER_AGENT }
      })
      return JSON.parse(res)
    } catch (e) {
      console.error('MusicBrainz release fetch error:', e)
      return null
    }
  }

  function buildHarmonyURL({gtin = '', mbid = ''} = {}) {
    const p = new URLSearchParams()
    p.set('url', '')
    p.set('gtin', gtin)
    p.set('region', '')
    p.set('musicbrainz', mbid)
    p.set('deezer', '')
    p.set('itunes', '')
    p.set('spotify', '')
    p.set('tidal', '')
    p.set('beatport', '')
    return `${HARMONY_BASE}?${p.toString()}`
  }

  function buildMagicISRCURL(tracks, mbid = '') {
    const params = tracks.map((track, i) => `isrc${i + 1}=${track.isrc}`).join('&')
    const base = `${MAGIC_ISRC_BASE}?${params}`
    return mbid ? `${base}&mbid=${mbid}` : base
  }

  function formatDuration(ms) {
    if (!ms) return ''
    const totalSeconds = Math.floor(ms / 1000)
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
  }

  async function readClipboardMBID() {
    try {
      const text = await navigator.clipboard.readText()
      const match = (text || '').trim().match(MBID_RE)
      return match ? match[0] : ''
    } catch {
      return ''
    }
  }

  function addSimple(content, node, parent) {
    const elem = document.createElement(node)
    elem.textContent = content
    elem.style.userSelect = 'text'
    parent.appendChild(elem)
    return elem
  }

  // Check if we're on an album or music-video page
  const pathParts = document.location.pathname.split('/')
  const entryType = pathParts[2]
  if (!['album', 'music-video'].includes(entryType)) {
    return
  }

  const albumId = document.location.pathname.split('/').reverse().find(p => /^\d+$/.test(p))
  const country = pathParts[1]

  if (!albumId) {
    return
  }

  // Fetch album data
  let albums = []
  try {
    const url = `${baseURL}/catalog/${country}/${entryType}s/${albumId}`
    const res = await fetchWrapper(url, {
      method: 'GET',
      mode: 'cors',
      credentials: 'include',
      headers: { Authorization: `Bearer ${token}`, Origin: new URL(baseURL).origin }
    })
    const resJson = JSON.parse(res)
    const albumsData = resJson.data

    for (const albumData of albumsData.filter((item) => item.type === 'albums')) {
      const album = {
        name: albumData.attributes.name,
        artist: albumData.attributes.artistName,
        releaseDate: albumData.attributes.releaseDate,
        label: albumData.attributes.recordLabel,
        barcode: albumData.attributes.upc,
        isMasteredForItunes: albumData.attributes.isMasteredForItunes,
        audio: albumData.attributes.audioTraits,
        copyright: albumData.attributes.copyright,
        tracks: [],
        differentDates: false,
      }

      if (albumData.relationships.tracks) {
        let tracksHaveDates = false
        for (const track_data of albumData.relationships.tracks.data) {
          const track = {
            name: track_data.attributes.name,
            artist: track_data.attributes.artistName,
            composer: track_data.attributes.composerName,
            disc: track_data.attributes.discNumber,
            track: track_data.attributes.trackNumber,
            isrc: track_data.attributes.isrc,
            releaseDate: track_data.attributes.releaseDate,
            duration: track_data.attributes.durationInMillis,
          }

          if (track.releaseDate !== album.releaseDate) {
            album.differentDates = true
          }

          if (!!track_data.attributes.releaseDate) {
            tracksHaveDates = true
          }

          album.tracks.push(track)
        }

        if (!tracksHaveDates) {
          album.differentDates = false
        }
      }

      albums.push(album)
    }

    for (const videoData of albumsData.filter((item) => item.type === 'music-videos')) {
      const album = {
        name: videoData.attributes.name,
        artist: videoData.attributes.artistName,
        releaseDate: videoData.attributes.releaseDate,
        tracks: [{
          name: videoData.attributes.name,
          artist: videoData.attributes.artistName,
          disc: 1,
          track: 1,
          isrc: videoData.attributes.isrc,
          releaseDate: videoData.attributes.releaseDate,
          duration: videoData.attributes.durationInMillis,
        }],
        differentDates: false,
      }

      albums.push(album)
    }
  } catch (e) {
    alert(`error fetching album data: ${e}`)
    return
  }

  if (albums.length === 0) {
    return
  }

  const album = albums[0]

  // MusicBrainz lookup by barcode
  let mbRelease = null
  let mbReleaseDetails = null
  if (album.barcode) {
    mbRelease = await searchMBByBarcode(album.barcode)
    if (mbRelease) {
      mbReleaseDetails = await fetchMBRelease(mbRelease.id)
    }
  }

  // Create the badge
  const infoBadge = document.createElement('div')
  infoBadge.style.position = 'fixed'
  infoBadge.style.top = '8px'
  infoBadge.style.left = '8px'
  infoBadge.style.zIndex = 2147483647
  infoBadge.style.background = '#1a1a1a'
  infoBadge.style.color = '#fff'
  infoBadge.style.padding = '6px 10px'
  infoBadge.style.borderRadius = '6px'
  infoBadge.style.fontFamily = '-apple-system, BlinkMacSystemFont, sans-serif'
  infoBadge.style.fontSize = '12px'
  infoBadge.style.cursor = 'pointer'
  infoBadge.style.userSelect = 'text'
  infoBadge.style.boxShadow = '0 2px 8px rgba(0,0,0,0.3)'

  if (album.barcode) {
    const upcSpan = document.createElement('span')
    upcSpan.textContent = `UPC: ${album.barcode}`
    upcSpan.style.cursor = 'pointer'
    upcSpan.title = 'Click to copy'
    upcSpan.addEventListener('click', async (e) => {
      e.stopPropagation()
      try {
        await navigator.clipboard.writeText(album.barcode)
        const original = upcSpan.textContent
        upcSpan.textContent = 'Copied!'
        upcSpan.style.color = '#0c0'
        setTimeout(() => {
          upcSpan.textContent = original
          upcSpan.style.color = ''
        }, 1000)
      } catch (err) {
        console.error('Failed to copy:', err)
      }
    })
    infoBadge.appendChild(upcSpan)
    
    if (album.label) {
      const sep = document.createElement('span')
      sep.textContent = ' · '
      infoBadge.appendChild(sep)
    }
  }

  if (album.label) {
    const labelSpan = document.createElement('span')
    labelSpan.textContent = album.label
    labelSpan.style.marginRight = '8px'
    infoBadge.appendChild(labelSpan)
  } else if (album.barcode) {
    const spacer = document.createElement('span')
    spacer.style.marginRight = '8px'
    infoBadge.appendChild(spacer)
  }

  const moreLink = document.createElement('span')
  moreLink.textContent = '▶ Details'
  moreLink.style.color = '#0af'
  moreLink.style.cursor = 'pointer'
  infoBadge.appendChild(moreLink)

  // Harmony Release Lookup button
  if (album.barcode) {
    const separator1 = document.createElement('span')
    separator1.textContent = ' · '
    infoBadge.appendChild(separator1)

    const harmonyLink = document.createElement('span')
    harmonyLink.textContent = 'Harmony'
    harmonyLink.style.color = '#0af'
    harmonyLink.style.cursor = 'pointer'
    harmonyLink.addEventListener('click', (e) => {
      e.stopPropagation()
      window.open(buildHarmonyURL({gtin: album.barcode}), '_blank')
    })
    infoBadge.appendChild(harmonyLink)

    // Harmony Release Lookup+ button
    const separator2 = document.createElement('span')
    separator2.textContent = ' · '
    infoBadge.appendChild(separator2)

    const harmonyPlusLink = document.createElement('span')
    harmonyPlusLink.textContent = 'Harmony+'
    harmonyPlusLink.style.color = '#0af'
    harmonyPlusLink.style.cursor = 'pointer'
    harmonyPlusLink.addEventListener('click', async (e) => {
      e.stopPropagation()
      const mbid = await readClipboardMBID()
      window.open(buildHarmonyURL({gtin: album.barcode, mbid}), '_blank')
    })
    infoBadge.appendChild(harmonyPlusLink)

    // MagicISRC link
    const separator3 = document.createElement('span')
    separator3.textContent = ' · '
    infoBadge.appendChild(separator3)

    const magicISRCLink = document.createElement('span')
    magicISRCLink.textContent = 'MagicISRC'
    magicISRCLink.style.color = '#0af'
    magicISRCLink.style.cursor = 'pointer'
    magicISRCLink.addEventListener('click', (e) => {
      e.stopPropagation()
      window.open(buildMagicISRCURL(album.tracks), '_blank')
    })
    infoBadge.appendChild(magicISRCLink)

    // MagicISRC+ link
    const separator4 = document.createElement('span')
    separator4.textContent = ' · '
    infoBadge.appendChild(separator4)

    const magicISRCPlusLink = document.createElement('span')
    magicISRCPlusLink.textContent = 'MagicISRC+'
    magicISRCPlusLink.style.color = '#0af'
    magicISRCPlusLink.style.cursor = 'pointer'
    magicISRCPlusLink.addEventListener('click', async (e) => {
      e.stopPropagation()
      const mbid = await readClipboardMBID()
      window.open(buildMagicISRCURL(album.tracks, mbid), '_blank')
    })
    infoBadge.appendChild(magicISRCPlusLink)
  }

  // MusicBrainz status line with indicators
  const mbLine = document.createElement('div')
  mbLine.style.marginTop = '4px'
  mbLine.style.fontSize = '11px'

  const checkMark = '✓'
  const crossMark = '✗'
  const greenColor = '#0c0'
  const redColor = '#c00'

  // Check if all MB tracks have ISRCs
  let allTracksHaveISRCs = false
  if (mbReleaseDetails && mbReleaseDetails.media) {
    allTracksHaveISRCs = mbReleaseDetails.media.every(medium =>
      (medium.tracks || []).every(track =>
        track.recording?.isrcs && track.recording.isrcs.length > 0
      )
    )
  }

  // Check if track counts match
  let trackCountMatches = false
  let mbTrackCount = 0
  if (mbReleaseDetails && mbReleaseDetails.media) {
    mbTrackCount = mbReleaseDetails.media.reduce((sum, medium) => sum + (medium.tracks || []).length, 0)
    trackCountMatches = album.tracks.length === mbTrackCount
  }

  // Check if all track lengths are within 2 seconds
  let trackLengthsMatch = false
  if (mbReleaseDetails && mbReleaseDetails.media && trackCountMatches) {
    const mbTracks = mbReleaseDetails.media.flatMap(medium => medium.tracks || [])
    trackLengthsMatch = album.tracks.every((appleTrack, i) => {
      const mbTrack = mbTracks[i]
      if (!appleTrack.duration || !mbTrack?.length) return false
      return Math.abs(appleTrack.duration - mbTrack.length) <= 2000
    })
  }

  // "On MusicBrainz" indicator
  if (mbRelease) {
    const mbLink = document.createElement('a')
    mbLink.href = `${MB_SITE}/release/${mbRelease.id}`
    mbLink.target = '_blank'
    mbLink.style.color = '#0af'
    mbLink.style.textDecoration = 'none'
    mbLink.addEventListener('click', (e) => e.stopPropagation())
    
    const mbCheck = document.createElement('span')
    mbCheck.textContent = checkMark
    mbCheck.style.color = greenColor
    mbCheck.style.marginRight = '2px'
    mbLink.appendChild(mbCheck)
    mbLink.appendChild(document.createTextNode('On MB'))
    mbLine.appendChild(mbLink)
  } else if (album.barcode) {
    const mbSpan = document.createElement('span')
    const mbX = document.createElement('span')
    mbX.textContent = crossMark
    mbX.style.color = redColor
    mbX.style.marginRight = '2px'
    mbSpan.appendChild(mbX)
    mbSpan.appendChild(document.createTextNode('On MB'))
    mbSpan.style.color = '#888'
    mbLine.appendChild(mbSpan)
  }

  // "GTIN" indicator
  if (album.barcode) {
    const gtinSep = document.createElement('span')
    gtinSep.textContent = ' · '
    mbLine.appendChild(gtinSep)

    const gtinSpan = document.createElement('span')
    const gtinMark = document.createElement('span')
    gtinMark.textContent = mbRelease ? checkMark : crossMark
    gtinMark.style.color = mbRelease ? greenColor : redColor
    gtinMark.style.marginRight = '2px'
    gtinSpan.appendChild(gtinMark)
    gtinSpan.appendChild(document.createTextNode('GTIN'))
    if (!mbRelease) gtinSpan.style.color = '#888'
    mbLine.appendChild(gtinSpan)
  }

  // "All ISRCs" indicator
  if (album.barcode) {
    const isrcSep = document.createElement('span')
    isrcSep.textContent = ' · '
    mbLine.appendChild(isrcSep)

    const isrcSpan = document.createElement('span')
    const isrcMark = document.createElement('span')
    isrcMark.textContent = (mbReleaseDetails && allTracksHaveISRCs) ? checkMark : crossMark
    isrcMark.style.color = (mbReleaseDetails && allTracksHaveISRCs) ? greenColor : redColor
    isrcMark.style.marginRight = '2px'
    isrcSpan.appendChild(isrcMark)
    isrcSpan.appendChild(document.createTextNode('All ISRCs'))
    if (!mbReleaseDetails || !allTracksHaveISRCs) isrcSpan.style.color = '#888'
    mbLine.appendChild(isrcSpan)
  }

  // "Trackcount" indicator
  if (album.barcode) {
    const countSep = document.createElement('span')
    countSep.textContent = ' · '
    mbLine.appendChild(countSep)

    const countSpan = document.createElement('span')
    const countMark = document.createElement('span')
    countMark.textContent = (mbReleaseDetails && trackCountMatches) ? checkMark : crossMark
    countMark.style.color = (mbReleaseDetails && trackCountMatches) ? greenColor : redColor
    countMark.style.marginRight = '2px'
    countSpan.appendChild(countMark)
    countSpan.appendChild(document.createTextNode('Trackcount'))
    if (!mbReleaseDetails || !trackCountMatches) countSpan.style.color = '#888'
    mbLine.appendChild(countSpan)
  }

  // "Tracklengths" indicator
  if (album.barcode) {
    const lengthSep = document.createElement('span')
    lengthSep.textContent = ' · '
    mbLine.appendChild(lengthSep)

    const lengthSpan = document.createElement('span')
    const lengthMark = document.createElement('span')
    lengthMark.textContent = (mbReleaseDetails && trackLengthsMatch) ? checkMark : crossMark
    lengthMark.style.color = (mbReleaseDetails && trackLengthsMatch) ? greenColor : redColor
    lengthMark.style.marginRight = '2px'
    lengthSpan.appendChild(lengthMark)
    lengthSpan.appendChild(document.createTextNode('Tracklengths'))
    if (!mbReleaseDetails || !trackLengthsMatch) lengthSpan.style.color = '#888'
    mbLine.appendChild(lengthSpan)
  }

  if (album.barcode) {
    infoBadge.appendChild(mbLine)
  }

  document.body.appendChild(infoBadge)

  // Click handler for details
  moreLink.addEventListener('click', (e) => {
    e.stopPropagation()

    let results

    const close = () => {
      document.body.removeEventListener('keydown', escListener)
      results.remove()
    }

    const escListener = (e) => {
      if (e.key === 'Escape') {
        close()
      }
    }

    results = addSimple('', 'div', document.body)
    results.style.position = 'fixed'
    results.style.inset = '30px'
    results.style.zIndex = 2147483647
    results.style.background = 'white'
    results.style.color = 'black'
    results.style.overflow = 'auto'
    results.style.padding = '16px'
    results.style.borderRadius = '8px'
    results.style.boxShadow = '0 4px 24px rgba(0,0,0,0.4)'

    document.body.addEventListener('keydown', escListener)

    for (const album of albums) {
      addSimple(album.name, 'h1', results)
      addSimple(album.artist, 'h2', results)
      const albumDate = addSimple(`Release Date: ${album.releaseDate}`, 'p', results)
      if (album.differentDates) {
        albumDate.appendChild(document.createTextNode(' '))
        const bold = document.createElement('b')
        bold.style.color = '#c00'
        bold.textContent = '(Some track dates differ)'
        albumDate.appendChild(bold)
      }
      if (album.label !== undefined) {
        addSimple(`Label: ${album.label}`, 'p', results)
      }
      if (album.barcode !== undefined) {
        addSimple(`Barcode: ${album.barcode}`, 'p', results)
      }
      if (album.isMasteredForItunes !== undefined) {
        addSimple(`Mastered for iTunes: ${album.isMasteredForItunes}`, 'p', results)
      }
      if (album.audio !== undefined) {
        addSimple(`Audio: ${album.audio}`, 'p', results)
      }
      if (album.copyright !== undefined) {
        addSimple(`Copyright: ${album.copyright}`, 'p', results)
      }

      const kepstinContainer = addSimple('', 'p', results)
      const kepstinLink = addSimple("Submit to kepstin's MagicISRC", 'a', kepstinContainer)
      kepstinLink.target = '_blank'
      kepstinLink.href = buildMagicISRCURL(album.tracks)
      kepstinLink.style.color = '#06c'
      kepstinLink.style.textDecoration = 'underline'
      kepstinLink.addEventListener('click', e => {
        e.preventDefault()
        e.stopPropagation()
        window.open(e.target.href, e.target.target)
      })

      const hasMultipleDiscs = album.tracks.some(t => t.disc !== 1)
      const hasComposers = album.tracks.some(t => t.composer !== undefined)

      const table = addSimple('', 'table', results)
      table.style.width = '100%'
      table.style.borderCollapse = 'separate'
      table.style.borderSpacing = '2px'
      table.setAttribute('border', '1')
      const thead = addSimple('', 'thead', table)
      thead.style.fontWeight = 'bold'
      const tr = addSimple('', 'tr', thead)
      const t1 = addSimple('Track', 'td', tr)
      t1.style.background = 'white'
      t1.style.position = 'sticky'
      t1.style.top = 0
      const t2 = addSimple('Title', 'td', tr)
      t2.style.background = 'white'
      t2.style.position = 'sticky'
      t2.style.top = 0
      const t3 = addSimple('Artist', 'td', tr)
      t3.style.background = 'white'
      t3.style.position = 'sticky'
      t3.style.top = 0
      if (hasComposers) {
        const t4 = addSimple('Composer', 'td', tr)
        t4.style.background = 'white'
        t4.style.position = 'sticky'
        t4.style.top = 0
      }
      const t5 = addSimple('ISRC', 'td', tr)
      t5.style.background = 'white'
      t5.style.position = 'sticky'
      t5.style.top = 0

      const tLen = addSimple('Length', 'td', tr)
      tLen.style.background = 'white'
      tLen.style.position = 'sticky'
      tLen.style.top = 0

      if (album.differentDates) {
        const t6 = addSimple('Date', 'td', tr)
        t6.style.background = 'white'
        t6.style.position = 'sticky'
        t6.style.top = 0
      }

      const tbody = addSimple('', 'tbody', table)
      for (const track of album.tracks) {
        const tr = addSimple('', 'tr', tbody)
        addSimple(hasMultipleDiscs ? `${track.disc}.${track.track}` : track.track, 'td', tr)
        addSimple(track.name, 'td', tr)
        addSimple(track.artist, 'td', tr)
        if (hasComposers) {
          addSimple(track.composer, 'td', tr)
        }
        addSimple(track.isrc, 'td', tr)
        addSimple(formatDuration(track.duration), 'td', tr)
        if (album.differentDates) {
          const trackDate = addSimple(track.releaseDate, 'td', tr)
          if (track.releaseDate !== album.releaseDate) {
            trackDate.style.fontWeight = 'bold'
            trackDate.style.color = '#c00'
          }
        }
      }
    }

    // MusicBrainz release details section
    if (mbReleaseDetails) {
      addSimple('', 'hr', results).style.margin = '24px 0'
      
      const mbHeader = addSimple('MusicBrainz Release', 'h1', results)
      mbHeader.style.color = '#eb743b'
      
      const mbLinkP = addSimple('', 'p', results)
      const mbLink = document.createElement('a')
      mbLink.href = `${MB_SITE}/release/${mbReleaseDetails.id}`
      mbLink.target = '_blank'
      mbLink.textContent = mbReleaseDetails.title
      mbLink.style.color = '#06c'
      mbLink.style.textDecoration = 'underline'
      mbLinkP.appendChild(mbLink)
      
      // Artist credit
      if (mbReleaseDetails['artist-credit']) {
        const artistCredit = mbReleaseDetails['artist-credit'].map(ac => ac.name + (ac.joinphrase || '')).join('')
        addSimple(artistCredit, 'h2', results)
      }
      
      // Release date
      if (mbReleaseDetails.date) {
        addSimple(`Release Date: ${mbReleaseDetails.date}`, 'p', results)
      }
      
      // Label
      if (mbReleaseDetails['label-info'] && mbReleaseDetails['label-info'].length > 0) {
        const labelInfo = mbReleaseDetails['label-info'][0]
        const labelParts = []
        if (labelInfo.label) labelParts.push(labelInfo.label.name)
        if (labelInfo['catalog-number']) labelParts.push(`Cat#: ${labelInfo['catalog-number']}`)
        if (labelParts.length > 0) {
          addSimple(`Label: ${labelParts.join(' · ')}`, 'p', results)
        }
      }
      
      // Barcode
      if (mbReleaseDetails.barcode) {
        addSimple(`Barcode: ${mbReleaseDetails.barcode}`, 'p', results)
      }
      
      // Tracklist
      if (mbReleaseDetails.media && mbReleaseDetails.media.length > 0) {
        const mbHasMultipleDiscs = mbReleaseDetails.media.length > 1
        
        const mbTable = addSimple('', 'table', results)
        mbTable.style.width = '100%'
        mbTable.style.borderCollapse = 'separate'
        mbTable.style.borderSpacing = '2px'
        mbTable.setAttribute('border', '1')
        
        const mbThead = addSimple('', 'thead', mbTable)
        mbThead.style.fontWeight = 'bold'
        const mbTr = addSimple('', 'tr', mbThead)
        
        const mbT1 = addSimple('Track', 'td', mbTr)
        mbT1.style.background = 'white'
        mbT1.style.position = 'sticky'
        mbT1.style.top = 0
        const mbT2 = addSimple('Title', 'td', mbTr)
        mbT2.style.background = 'white'
        mbT2.style.position = 'sticky'
        mbT2.style.top = 0
        const mbT3 = addSimple('Artist', 'td', mbTr)
        mbT3.style.background = 'white'
        mbT3.style.position = 'sticky'
        mbT3.style.top = 0
        const mbT4 = addSimple('ISRC', 'td', mbTr)
        mbT4.style.background = 'white'
        mbT4.style.position = 'sticky'
        mbT4.style.top = 0
        const mbT5 = addSimple('Length', 'td', mbTr)
        mbT5.style.background = 'white'
        mbT5.style.position = 'sticky'
        mbT5.style.top = 0
        
        const mbTbody = addSimple('', 'tbody', mbTable)
        
        for (let discIndex = 0; discIndex < mbReleaseDetails.media.length; discIndex++) {
          const medium = mbReleaseDetails.media[discIndex]
          for (const track of medium.tracks || []) {
            const tr = addSimple('', 'tr', mbTbody)
            const trackNum = mbHasMultipleDiscs ? `${discIndex + 1}.${track.position}` : track.position
            addSimple(trackNum, 'td', tr)
            addSimple(track.title, 'td', tr)
            
            // Track artist credit
            const trackArtist = track['artist-credit'] 
              ? track['artist-credit'].map(ac => ac.name + (ac.joinphrase || '')).join('')
              : ''
            addSimple(trackArtist, 'td', tr)
            
            // ISRCs from recording
            const isrcs = track.recording?.isrcs || []
            addSimple(isrcs.join(', '), 'td', tr)
            
            // Track length
            addSimple(formatDuration(track.length), 'td', tr)
          }
        }
      }
    } else if (album.barcode) {
      addSimple('', 'hr', results).style.margin = '24px 0'
      const notFound = addSimple('Not found on MusicBrainz', 'p', results)
      notFound.style.color = '#888'
    }

    addSimple('Press ESC to close', 'p', results)
  })

})()
