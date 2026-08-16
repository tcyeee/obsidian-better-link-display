/**
 * The favicon the settings preview wears. Inlined rather than fetched because the
 * preview has to render with no token, no network and no formatted note to look
 * at — and because it must be an `img` with a `data:` source to pick up the very
 * rules it is previewing (`styles.css` sizes the icon off that selector).
 *
 * A 48×48 PNG, the same size `favicon.ts` re-encodes real icons to, so the
 * preview shrinks it to 16px through the same path a real bookmark does.
 */
export const PREVIEW_ICON =
	"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAACUElEQVR42u1ZvUoEMRDeR7hH2Ue417C+WlstF+xsrrRTsLGxsbGxWCysBNMdiiCHIIg/rAiHIMLIt2Qgl83OJneeXsIODHebTGbnSyZfskmW9dLLeggRDYmoIKKSiBQ1Rek62AzXJeiciA6JqLKjfX3+cv43pNJt8/8KvOTgzAAfpp+0tzutlYWfUWeCMtqVfwKEiAZENOYADvYfaXvrbi74zdEtjTYmDQAoQ50JAm3hwwAC34NV9rqazb7p+OipDgh6M5k1gm8DYINAWy6HT/jWcyVfRfAVXlzs3DuDNMslAFDYuupQrsFVvwbCDN7sYejlxXsdxOnJy1x5FwAo2kDgwyw3Rmh5EFLweIZg2O06HwBoo1PG6XtpEHrCKlfwUEw+yPnZW6POBwAUbSHw5QKoQaiFJjYYAT1k5zbr9dWHM/dDAPBcgK+2ej1K40VSZ45tbGXmaav3AQBlRmqrRwxa8hAAJbi5K7i29AkBwGkk2eh1ogzqfVde2gwivdQXANu5mMyeb16jgP2J1PsmfUo2vgA4HW06bRmFQx8AlZQavPpK+R8KAL7MVVlItcpnS9zKLGaPdb0wBABvRyQbY/UeSgAK0JbkiAFIORsKgOdU13s1pRYi+3T1LPfEKgB0jbweqVICoHwDk1gqFACzjCdQJQGo2YA/QFzKCwt+fexCbLvsmP1EADFI2gBiT6HoJ3H0NBr9Qhb3ViL6zVwq2+m4P2ii/6RM4qM++mOVJA62oj9aTOJwN4nj9SQuOJK4Ykriki+Za9ZkLrp76SXLfgDQxG7AZaoZUAAAAABJRU5ErkJggg==";
