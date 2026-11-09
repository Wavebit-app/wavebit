import { createContext, useContext, type RefObject } from 'react';

/** The workspace's scrolling element, for virtualized lists inside pages. */
export const ScrollContext = createContext<RefObject<HTMLElement | null>>({
  current: null,
});
export const useScrollElement = () => useContext(ScrollContext);
