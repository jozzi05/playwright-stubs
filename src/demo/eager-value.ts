import { foo } from './dependency'

// This is intentionally evaluated while the lazy story import is resolving.
// The lifecycle test proves the stub has been installed before that happens.
export const valueAtEvaluation = foo(10)
