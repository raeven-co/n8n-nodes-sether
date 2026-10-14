import {
	basicDetectors,
	createMultiRegionPhoneDetector,
	identityDetectors,
	secretsDetectors,
	type Detector,
} from '@raeven-co/sether';
import { isSupportedCountry, type CountryCode } from 'libphonenumber-js';
import { SetherInputError } from './errors';

export const DETECTOR_PACKS = ['basic', 'secrets', 'identity'] as const;
export type DetectorPack = (typeof DETECTOR_PACKS)[number];

const PACK_DETECTORS: Record<DetectorPack, readonly Detector[]> = {
	basic: basicDetectors,
	secrets: secretsDetectors,
	identity: identityDetectors,
};

export function isDetectorPack(value: unknown): value is DetectorPack {
	return DETECTOR_PACKS.some((pack) => pack === value);
}

/**
 * Detectors for the selected packs. `phoneRegions` (ISO 3166-1 alpha-2) swaps
 * the basic pack's phone detector, which only finds numbers written with a
 * country code, for one that also parses those regions' national formats.
 */
export function buildDetectors(
	packs: readonly DetectorPack[],
	phoneRegions: readonly string[],
): Detector[] {
	if (packs.length === 0) {
		throw new SetherInputError('Select at least one detector pack');
	}
	return packs.flatMap((pack) =>
		pack === 'basic' ? basicWithRegions(phoneRegions) : [...PACK_DETECTORS[pack]],
	);
}

function basicWithRegions(phoneRegions: readonly string[]): Detector[] {
	if (phoneRegions.length === 0) return [...basicDetectors];
	const phone = createMultiRegionPhoneDetector(phoneRegions.map(toPhoneRegion));
	return [...basicDetectors.filter((detector) => detector.type !== 'PHONE'), phone];
}

// An unsupported region (for example "UK" instead of "GB") makes Sether's
// phone detector match nothing, silently. Reject it up front instead.
function toPhoneRegion(region: string): CountryCode {
	const code = region.trim().toUpperCase();
	if (!isSupportedCountry(code)) {
		throw new SetherInputError(`Phone region "${region}" is not a supported country code`);
	}
	return code;
}
