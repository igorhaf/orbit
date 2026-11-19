/** Explicit opt-in permissions. Never included in automatic role defaults. */
export const discoveryEditorialPermissions=[
 'discovery_review.current','discovery_review.history','discovery_review.start_review',
 'discovery_review.request_information','discovery_review.approve','discovery_review.reject',
 'discovery_review.withdraw_approval',
] as const;
