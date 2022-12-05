import type { BaseComponentProps, Disposable, ForeignComponent } from 'piral-core';
import { addGlobalEventListeners, attachEvents, removeGlobalEventListeners } from './events';
import { activate, deactivate, createBootLoader, reactivate, callNotifyLocationChanged, createElement, destroyElement, updateElement } from './interop';
import { BlazorDependencyLoader, BlazorOptions, BlazorRootConfig } from './types';
import bootConfig from '../infra.codegen';

const noop = () => {};

const mediaRules = [
  { attribute: 'src', selector: 'img, embed, video > source, video > track, audio > source' },
  { attribute: 'srcset', selector: 'picture > source' },
];

function prefixMediaSources(component: Element, prefix: string) {
  const prefixAttributeValue = (el: Element, attr: string) => el.setAttribute(attr, prefix + el.getAttribute(attr));

  for (const { attribute, selector } of mediaRules) {
    Array.from(component.querySelectorAll(selector))
      .filter((el) => el.hasAttribute(attribute) && !el.getAttribute(attribute).match(/^https?:/))
      .forEach((el) => prefixAttributeValue(el, attribute));
  }
}

function project(component: Element, destination: Element, options: BlazorOptions) {
  if (options?.resourcePathRoot && !bootConfig.noMutation) {
    prefixMediaSources(component, options.resourcePathRoot);
  }

  destination.appendChild(component);
}

function makeUrl(href: string) {
  const origin = document.location.origin;

  if (!href.startsWith(origin)) {
    return `${origin}${href}`;
  }

  return href;
}

interface BlazorLocals {
  unmount?(): void;
  update?(props: any): void;
  dispose(): void;
  next(config: BlazorRootConfig): void;
  state: 'fresh' | 'mounted' | 'removed';
}

export function createConverter(lazy: boolean) {
  const boot = createBootLoader(bootConfig.url, bootConfig.satellites);
  let loader = !lazy && boot();
  let listener: Disposable = undefined;

  const enqueueChange = (locals: BlazorLocals, update: (root: BlazorRootConfig) => void) => {
    if (typeof update !== 'function') {
      // nothing to do in this case
    } else if (locals.state === 'mounted') {
      loader.then(update);
    } else {
      locals.next = update;
    }
  };

  const convert = <TProps extends BaseComponentProps>(
    moduleName: string,
    dependency: BlazorDependencyLoader,
    args: Record<string, any>,
    options?: BlazorOptions,
  ): ForeignComponent<TProps> => ({
    mount(el, data, ctx, locals: BlazorLocals) {
      const props = { ...args, ...data };
      const nav = ctx.navigation;
      el.setAttribute('data-blazor-pilet-root', 'true');

      addGlobalEventListeners(el);

      if (listener === undefined) {
        listener = nav.listen(({ location, action }) => {
          // POP is already handled by .NET
          if (action !== 'POP') {
            const url = makeUrl(location.href);
            callNotifyLocationChanged(url, action === 'REPLACE');
          }
        });
      }

      locals.state = 'fresh';
      locals.next = noop;
      locals.dispose = attachEvents(
          el,
          (ev) => data.piral.renderHtmlExtension(ev.detail.target, ev.detail.props),
          (ev) =>
            ev.detail.replace ? nav.replace(ev.detail.to, ev.detail.store) : nav.push(ev.detail.to, ev.detail.state),
        );

      function mountClassic(config: BlazorRootConfig) {
        return activate(moduleName, props).then((refId) => {
          const [root] = config;
          const node = root.querySelector(`#${refId} > div`);

          locals.unmount = () => {
            root.querySelector(`#${refId}`)?.appendChild(node);
            deactivate(moduleName, refId);
            el.innerHTML = '';
          };

          locals.update = (props) => {
            reactivate(moduleName, refId, props);
          };

          project(node, el, options);
        });
      }

      function mountModern(_: BlazorRootConfig) {
        return createElement(moduleName, props).then((refId) => {
          const child = document.createElement('piral-blazor-component');
          child.setAttribute('rid', refId);
          el.appendChild(child);

          locals.unmount = () => {
            destroyElement(refId);
            child.remove();
            el.innerHTML = '';
          };

          locals.update = (props) => {
            updateElement(refId, props);
          };
        });
      }

      (loader || (loader = boot()))
        .then((config) =>
          dependency(config).then(() => {
            if (locals.state === 'fresh') {
              const [_, capabilities] = config;
              const fn = capabilities.includes('custom-element') ? mountModern : mountClassic;
              return fn(config).then(() => {
                locals.state = 'mounted';
                locals.next(config);
                locals.next = noop;
              });
            }
          }),
        )
        .catch((err) => console.error(err));
    },
    update(el, data, ctx, locals: BlazorLocals) {
      enqueueChange(locals, () => {
        locals.update?.({ ...args, ...data });
      });
    },
    unmount(el, locals: BlazorLocals) {
      removeGlobalEventListeners(el);
      el.removeAttribute('data-blazor-pilet-root');
      locals.dispose();
      enqueueChange(locals, locals.unmount);
      locals.state = 'removed';
    },
  });

  convert.loader = loader;
  return convert;
}
