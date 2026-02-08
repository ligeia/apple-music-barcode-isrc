# Apple Music Barcodes/ISRCs

A modified version of ToadKing's userscript.

This version replaces ToadKing's clickable green square with a mini-panel that shows:
1) GTIN - click on GTIN to copy to clipboard
2) Label
3) Harmony lookup buttons - normal Harmony does a Harmony lookup using the surfaced barcode, Harmony+ does that lookup while also checking your clipboard for an MBID which will be added to the lookup if present
4) MagicISRC lookup buttons - normal MagicISRC passes the Apple ISRCs to MagicISRC, MagicISRC+ checks your clipboard for an MBID which will be added to the MagicISRC lookup if presents
5) Whether the release exists on MusicBrainz (matching based on GTIN)
6) Whether the matched release on MusicBrainz matches tracklist and has all ISRCs already.

Users can also open the "Details" panel to review more detail on what Apple surfaces as well as details about the matched MusicBrainz release if one was found.

Some notes about the script:
* It uses a hardcoded access token for Apple's music server. It's possible this can change at any time, and if it does the script will need to be updated for it. The quickest way to alert me of this is to make an issue on this repo.
* I've ran into a couple of times during testing where I get locked out of the site for making too many requests. This appears as an infinite loading screen on the site. If that happens you have to wait a couple of minutes before you can access the site again.

Tested with Tampermonkey in Chrome.

# Configuration
Script allows you to easily change the base url for
1) Harmony
2) MagicISRC
3) MusicBrainz
