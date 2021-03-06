import { until } from '@open-draft/until'
import { RequestHandler } from './handlers/requestHandler'
import { createIncomingRequestHandler } from './handleIncomingRequest'
import { requestIntegrityCheck } from './requestIntegrityCheck'

export type Mask = RegExp | string

interface PublicAPI {
  start(
    serviceWorkerURL?: string,
    options?: RegistrationOptions,
  ): Promise<ServiceWorkerRegistration>
  stop(): Promise<void>
}

const createStart = (
  worker: ServiceWorker,
  workerRegistration: ServiceWorkerRegistration,
): PublicAPI['start'] => {
  /**
   * Registers and activates the MockServiceWorker at the given URL.
   */
  return async (serviceWorkerUrl = './mockServiceWorker.js', options) => {
    if (workerRegistration) {
      return workerRegistration.update().then(() => workerRegistration)
    }

    window.addEventListener('beforeunload', () => {
      // Prevent Service Worker from serving page assets on initial load
      if (worker && worker.state !== 'redundant') {
        worker.postMessage('MOCK_DEACTIVATE')
      }
    })

    const [error, data] = await until<
      [ServiceWorker, ServiceWorkerRegistration]
    >(() =>
      navigator.serviceWorker
        .register(serviceWorkerUrl, options)
        .then((registration) => {
          const instance =
            registration.active ||
            registration.installing ||
            registration.waiting
          return [instance, registration]
        }),
    )

    if (error) {
      console.error(
        '[MSW] Failed to register Service Worker (%s). %o',
        serviceWorkerUrl,
        error,
      )
      return
    }

    const [serviceWorker, registration] = data

    const [integrityError] = await until(() =>
      requestIntegrityCheck(serviceWorker),
    )

    if (integrityError) {
      console.error(`\
[MSW] Failed to activate Service Worker: integrity check didn't pass.

This error most likely means that the "mockServiceWorker.js" file served by your application is older than the Service Worker module distributed in the latest release of the library. Please update your Service Worker by running the following command in your project's root directory:

$ npx msw init <PUBLIC_DIR>

If this error message persists after the successful initialization of a new Service Worker, please report an issue: https://github.com/open-draft/msw/issues\
      `)
      return
    }

    // Signal Service Worker to enable requests interception
    serviceWorker.postMessage('MOCK_ACTIVATE')
    worker = serviceWorker
    workerRegistration = registration

    return workerRegistration
  }
}

const createStop = (
  worker: ServiceWorker,
  workerRegistration: ServiceWorkerRegistration,
): PublicAPI['stop'] => {
  /**
   * Stops active running instance of MockServiceWorker.
   */
  return () => {
    if (!workerRegistration) {
      console.warn('[MSW] No active instance of Service Worker is running.')
      return null
    }

    return workerRegistration
      .unregister()
      .then(() => {
        worker = null
        workerRegistration = null
      })
      .catch((error) => {
        console.error('[MSW] Failed to unregister Service Worker. %o', error)
      })
  }
}

export const composeMocks = (
  ...requestHandlers: RequestHandler<any>[]
): PublicAPI => {
  let worker: ServiceWorker
  let workerRegistration: ServiceWorkerRegistration

  navigator.serviceWorker.addEventListener(
    'message',
    createIncomingRequestHandler(requestHandlers),
  )

  return {
    start: createStart(worker, workerRegistration),
    stop: createStop(worker, workerRegistration),
  }
}
