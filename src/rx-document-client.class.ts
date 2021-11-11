import {DocumentClient} from 'aws-sdk/clients/dynamodb';
import {defer, EMPTY, expand, from, lastValueFrom, mergeMap, Observable, OperatorFunction, pipe, toArray} from 'rxjs';
import {concatMap, bufferCount} from 'rxjs/operators';
import {DynamoIteratorFactory} from 'dynamo-iterator';

export type GetInput = {TableName: string} & Omit<DocumentClient.KeysAndAttributes, 'Keys'>;

/**
 * DynamoDB helper using rxjs library for reactive programming
 */
export default class RxDocumentClient {

	constructor(
		private readonly documentClient: DocumentClient,
		private readonly dynamoIterator: DynamoIteratorFactory,
	) {}

	public get(input: GetInput): OperatorFunction<DocumentClient.Key, DocumentClient.AttributeMap | undefined> {
		return pipe(
			bufferCount(100),
			concatMap((keysBatch) => defer(() => this.keysToItemsSorted(input, keysBatch))),
		);
	}

	public scan$(input: DocumentClient.ScanInput): Observable<DocumentClient.AttributeMap> {
		return from(this.dynamoIterator.scan(input));
	}

	public query$(input: DocumentClient.ScanInput): Observable<DocumentClient.AttributeMap> {
		return from(this.dynamoIterator.query(input));
	}

	private async keysToItemsSorted(input: GetInput, keys: DocumentClient.Key[]): Promise<DocumentClient.AttributeMap | undefined[]> {
		const unsortedItems = [...await this.itemsFromKeys(input, keys)];

		return keys.map((key) => unsortedItems.find((item) => this.keyIsFromItem(key, item)));
	}

	private async itemsFromKeys(input: GetInput, keys: DocumentClient.Key[]): Promise<Set<DocumentClient.AttributeMap>> {
		return new Set(await lastValueFrom(defer(() => this.documentClient.batchGet({
			RequestItems: {
				[input.TableName]: Object.assign({ Keys: keys }, input, {TableName: undefined}),
			},
		}).promise()).pipe(
			expand((output) => output.UnprocessedKeys ? this.documentClient.batchGet({
				RequestItems: output.UnprocessedKeys,
			}).promise() : EMPTY),
		).pipe(
			mergeMap<DocumentClient.BatchGetItemOutput, DocumentClient.ItemList>((output) => output.Responses?.[input.TableName] ?? []),
			toArray(),
		)));
	}

	private keyIsFromItem(key: DocumentClient.Key, item: DocumentClient.AttributeMap): boolean {
		return Object.keys(key).every((i) => key[i] === item[i]);
	}
}
