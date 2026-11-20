export async function withReleasedLease<T>(work: () => Promise<T>, release: () => void): Promise<T> {
  try {
    return await work();
  } finally {
    release();
  }
}
