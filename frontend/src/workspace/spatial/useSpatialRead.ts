import {useEffect, useState} from 'react';
import {IDENTITY_STORAGE_KEY, read, sessionToken} from '../../integration/client';
import {createSpatialReadCache} from './spatialReadCache';

const cache = createSpatialReadCache(read, sessionToken);

/** Reuse map metadata when returning through the hierarchy; imports always refresh it. */
export function useSpatialRead<T>(path: string | null) {
  const token = sessionToken(), key = JSON.stringify([token, path]);
  const [result, setResult] = useState<{key: string; data?: T; error?: string}>({key: ''});
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    if (!path) return;
    setResult(previous => previous.key === key ? {...previous, error: undefined} : {key});
    cache.read<T>(token, path).then(data => {
      if (active && token === sessionToken()) setResult({key, data});
    }, error => {
      if (active && token === sessionToken()) setResult(previous => previous.key === key ? {...previous, error: error.message} : {key, error: error.message});
    });
    return () => {active = false;};
  }, [path, token, revision]);
  useEffect(() => {
    const refresh = () => {cache.invalidate(); setRevision(value => value + 1);};
    const identityChanged = (event: StorageEvent) => {if (event.key === IDENTITY_STORAGE_KEY || event.key === null) refresh();};
    window.addEventListener('harness-field-data-changed', refresh);
    window.addEventListener('storage', identityChanged);
    return () => {
      window.removeEventListener('harness-field-data-changed', refresh);
      window.removeEventListener('storage', identityChanged);
    };
  }, []);
  const cached = path ? cache.cached<T>(token, path) : undefined;
  return {...(result.key === key ? result : {}), ...(cached === undefined ? {} : {data: cached}), reload: () => {cache.invalidate(); setRevision(value => value + 1);}};
}
