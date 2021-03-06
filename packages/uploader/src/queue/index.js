// @flow
import { logger, getUpdateable } from "@rpldy/shared";
import { SENDER_EVENTS, UPLOADER_EVENTS } from "../consts";
import processQueueNext from "./processQueueNext";
import * as abortMethods from "./abort";

import type { Cancellable, Batch, BatchItem } from "@rpldy/shared";
import type { TriggerMethod } from "@rpldy/life-events";
import type { ItemsSender, CreateOptions } from "../types";
import type { State } from "./types";

export default (
    options: CreateOptions,
    cancellable: Cancellable,
    trigger: TriggerMethod,
    sender: ItemsSender,
    uploaderId: string,
) => {
    const { state, update } = getUpdateable<State>({
        itemQueue: [],
        currentBatch: null,
        batches: {},
        items: {},
        activeIds: [],
        aborts: {},
    });

    const getState = () => state;

    const updateState = (updater: (State) => void) => {
        update(updater);
    };

    const add = (item: BatchItem) => {
        updateState((state) => {
            state.items[item.id] = item;
            state.itemQueue.push(item.id);
        });
    };

    const uploadBatch = (batch: Batch, batchOptions: CreateOptions) => {
        updateState((state) => {
            state.batches[batch.id] = { batch, batchOptions };
        });

        batch.items.forEach(add);

        processQueueNext(queueState);
    };

    const handleItemProgress = (item: BatchItem, completed: number, loaded: number) => {
        if (state.items[item.id]) {
            updateState((state: State) => {
                const stateItem = state.items[item.id];
                stateItem.loaded = loaded;
                stateItem.completed = completed;
            });

            //trigger item progress event for the outside
            trigger(UPLOADER_EVENTS.ITEM_PROGRESS, getState().items[item.id]);
        }
    };

    sender.on(SENDER_EVENTS.ITEM_PROGRESS, handleItemProgress);

    sender.on(SENDER_EVENTS.BATCH_PROGRESS,
        (batch: Batch) => {
            const batchItems = state
                .batches[batch.id]?.batch
                .items;

            if (batchItems) {
                const [completed, loaded] = batchItems
                    .reduce((res, item) => {
                        res[0] += item.completed;
                        res[1] += item.loaded;
                        return res;
                    }, [0, 0]);

                updateState((state: State) => {
                    const stateBatch = state.batches[batch.id].batch;
                    //average of completed percentage for batch items
                    stateBatch.completed = completed / batchItems.length;
                    //sum of loaded bytes for batch items
                    stateBatch.loaded = loaded;
                });

                trigger(UPLOADER_EVENTS.BATCH_PROGRESS, state.batches[batch.id].batch);
            }
        });

    const queueState = {
        getOptions: () => options,
        getCurrentActiveCount: () => state.activeIds.length,
        getState,
        updateState,
        trigger,
        cancellable,
        sender,
        handleItemProgress,
    };

    if (logger.isDebugOn()) {
        window[`__${uploaderId}_queue_state`] = queueState;
    }

    const abortItem = (id: string) => {
        return abortMethods.abortItem(queueState, id);
    };

    const abortBatch = (id: string) => {
        abortMethods.abortBatch(queueState, id);
    };

    const abortAll = () => {
        abortMethods.abortAll(queueState);
    };

    return {
        updateState,
        getState: queueState.getState,
        uploadBatch,
        abortItem,
        abortBatch,
        abortAll,
    };
};
