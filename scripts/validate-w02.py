"""Audit W02 contract examples and fixture facts, without compiling TypeScript or running a server."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import runpy
import uuid
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EXAMPLES_PATH = ROOT / 'docs/examples/protocol.json'
META = {'protocolVersion', 'serverEpoch', 'serverTime'}
FAILURE = META | {'ok', 'code', 'retryable', 'retryAfterMs', 'fieldIssues', 'roomId', 'handId', 'latestRoomVersion', 'latestHandVersion'}
ROOM = META | {'roomId', 'roomCode', 'roomVersion', 'matchId', 'currentHandId', 'capacity', 'status', 'hostParticipantId', 'seats', 'canStart', 'startBlockReasons', 'resetProposal'}
HAND = {'roomId', 'matchId', 'handId', 'handVersion', 'phase', 'dealerSeatId', 'smallBlindSeatId', 'bigBlindSeatId', 'players', 'board', 'showdownCards', 'pots', 'potTotal', 'actorSeatId', 'turnId', 'deadline', 'publicEventSequence'}
RESULT = {'roomId', 'matchId', 'handId', 'handVersion', 'phase', 'board', 'showdownCards', 'pots', 'refunds', 'finalStacks', 'reason'}
ACTIONS = {'fold', 'check', 'call', 'bet', 'raise', 'allIn'}
REQUEST_FIELDS = {
    'session:guest': {'requestId', 'nickname'},
    'session:resume': {'requestId', 'resumeToken', 'roomId', 'lastSeenHandId', 'lastSeenRoomVersion', 'lastSeenHandVersion'},
    'room:create': {'commandId', 'capacity', 'nickname'},
    'room:join': {'commandId', 'roomCode', 'nickname'},
    'room:ready': {'commandId', 'roomId', 'expectedRoomVersion', 'ready'},
    'room:capacity:set': {'commandId', 'roomId', 'expectedRoomVersion', 'capacity'},
    'room:bot:add': {'commandId', 'roomId', 'expectedRoomVersion', 'seatId', 'difficulty'},
    'room:bot:remove': {'commandId', 'roomId', 'expectedRoomVersion', 'seatId'},
    'room:start': {'commandId', 'roomId', 'expectedRoomVersion'},
    'game:action': {'commandId', 'roomId', 'handId', 'turnId', 'expectedVersion', 'action'},
    'room:leave': {'commandId', 'roomId'},
    'room:reset:propose': {'commandId', 'roomId', 'expectedRoomVersion'},
    'room:reset:cancel': {'commandId', 'roomId', 'expectedRoomVersion'},
    'history:list': {'requestId', 'cursor', 'limit'},
    'replay:get': {'requestId', 'handId'},
}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def fields(value, expected, label):
    require(isinstance(value, dict) and set(value) == expected, label + ' field mismatch')


def integer(value, label, minimum=0):
    require(type(value) is int and minimum <= value <= 9007199254740991, label + ' invalid integer')


def walk(value, path=()):
    if isinstance(value, dict):
        for key, child in value.items():
            yield path + (key,), child
            yield from walk(child, path + (key,))
    elif isinstance(value, list):
        for index, child in enumerate(value):
            yield from walk(child, path + (str(index),))


def metadata(value):
    require(value['protocolVersion'] == 1 and isinstance(value['serverEpoch'], str), 'metadata')
    integer(value['serverTime'], 'serverTime')


def room_view(value):
    fields(value, ROOM, 'RoomView')
    metadata(value)
    require(value['capacity'] in (2, 3, 4), 'capacity')
    integer(value['roomVersion'], 'roomVersion')
    require(re.fullmatch(r'[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}', value['roomCode']) is not None, 'roomCode')
    require(len(value['seats']) == 4 and {s['seatId'] for s in value['seats']} == {0, 1, 2, 3}, 'four logical seats')
    occupied = []
    for seat in value['seats']:
        fields(seat, {'seatId', 'availability', 'occupant'}, 'PublicSeatView')
        occupant = seat['occupant']
        if occupant is None:
            require(seat['availability'] in ('open', 'capacityClosed'), 'empty seat state')
            continue
        require(seat['availability'] == 'occupied', 'occupied seat state')
        fields(occupant, {'participantId', 'nickname', 'stack', 'admission', 'kind', 'difficulty', 'online', 'ready', 'isHost'}, 'occupant')
        integer(occupant['stack'], 'seat stack')
        if occupant['kind'] == 'human':
            require(occupant['difficulty'] is None and type(occupant['ready']) is bool, 'human fields')
        else:
            require(occupant['kind'] == 'bot' and occupant['difficulty'] in ('basic', 'standard'), 'bot difficulty')
            require(occupant['ready'] is None and occupant['online'] is True and occupant['isHost'] is False, 'bot fields')
        occupied.append(occupant['participantId'])
    require(len(occupied) == len(set(occupied)) <= value['capacity'], 'occupied count')
    require(sum(s['availability'] == 'open' for s in value['seats']) == value['capacity'] - len(occupied), 'open seat count')
    require(value['canStart'] == (not value['startBlockReasons']), 'start reasons')


def hand_state(value, cards, replay=False):
    fields(value, HAND - {'turnId', 'deadline'} if replay else HAND, 'hand state')
    integer(value['handVersion'], 'handVersion')
    require(len(value['players']) in (2, 3, 4), 'hand participant count')
    require(len({p['participantId'] for p in value['players']}) == len(value['players']), 'duplicate hand participant')
    require(len({p['seatId'] for p in value['players']}) == len(value['players']), 'duplicate hand seat')
    for player in value['players']:
        fields(player, {'participantId', 'seatId', 'stack', 'streetCommitted', 'handCommitted', 'folded', 'allIn', 'hiddenCardCount'}, 'HandSeatView')
        for key in ('stack', 'streetCommitted', 'handCommitted'):
            integer(player[key], key)
        require(player['streetCommitted'] <= player['handCommitted'], 'street contribution double count')
        require(player['hiddenCardCount'] in (0, 2), 'hidden card count')
    require(sum(p['handCommitted'] for p in value['players']) == value['potTotal'], 'live pot total')
    if value['pots']:
        require(sum(p['amount'] for p in value['pots']) == value['potTotal'], 'pot breakdown total')
    known = list(value['board'])
    for shown in value['showdownCards']:
        fields(shown, {'participantId', 'cards'}, 'revealed cards')
        owner = next(p for p in value['players'] if p['participantId'] == shown['participantId'])
        require(not owner['folded'] and owner['hiddenCardCount'] == 0 and len(shown['cards']) == 2, 'illegal public reveal')
        known += shown['cards']
    require(all(card in cards for card in known) and len(known) == len(set(known)), 'public card uniqueness')
    phase = value['phase']
    phases = ('preflop', 'flop', 'turn', 'river', 'showdown', 'settled') + (('interrupted',) if replay else ())
    require(phase in phases, 'phase')
    expected_length = {'preflop': 0, 'flop': 3, 'turn': 4, 'river': 5, 'showdown': 5}
    if phase in expected_length:
        require(len(value['board']) == expected_length[phase], 'board stage size')
    if value['actorSeatId'] is not None:
        actor = next(p for p in value['players'] if p['seatId'] == value['actorSeatId'])
        require(not actor['folded'] and not actor['allIn'], 'invalid actor')
    if not replay:
        require((value['actorSeatId'] is None) == (value['turnId'] is None) == (value['deadline'] is None), 'live turn fields')


def player_view(value, cards):
    fields(value, META | HAND | {'roomVersion', 'self'}, 'PlayerView')
    metadata(value)
    hand_state({key: value[key] for key in HAND}, cards)
    owner = value['self']
    fields(owner, {'participantId', 'admission', 'holeCards', 'legalActions'}, 'self')
    choices = owner['legalActions']
    fields(choices, {'allowed', 'callAmount', 'minRaiseTo', 'maxRaiseTo', 'allIn'}, 'legalActions')
    require(set(choices['allowed']) <= ACTIONS and len(choices['allowed']) == len(set(choices['allowed'])), 'allowed actions')
    participant = next((p for p in value['players'] if p['participantId'] == owner['participantId']), None)
    if owner['holeCards'] is not None:
        require(participant is not None and len(owner['holeCards']) == 2, 'owner cards require participation')
        require(all(card in cards for card in owner['holeCards']) and len(set(owner['holeCards'])) == 2, 'owner card IDs')
        require(not set(owner['holeCards']) & set(value['board']), 'owner cards overlap board')
    if not choices['allowed']:
        require(choices['callAmount'] == 0 and choices['minRaiseTo'] is None and choices['maxRaiseTo'] is None and choices['allIn'] is None, 'empty controls')
    else:
        require(participant is not None and value['actorSeatId'] == participant['seatId'], 'non-actor controls')
        require(not participant['folded'] and not participant['allIn'], 'inactive controls')
        if 'raise' in choices['allowed'] or 'bet' in choices['allowed']:
            require(0 <= choices['minRaiseTo'] <= choices['maxRaiseTo'] == participant['stack'] + participant['streetCommitted'], 'raise range')
        if 'call' in choices['allowed']:
            require(0 < choices['callAmount'] < participant['stack'], 'normal call range')
        if 'allIn' in choices['allowed']:
            require(choices['allIn']['additionalAmount'] == participant['stack'], 'all-in cost')
            require(choices['allIn']['raiseTo'] == participant['stack'] + participant['streetCommitted'], 'all-in total')


def replay_view(value, row, cards, evaluate):
    fields(value, META | {'requestId', 'ok', 'handId', 'viewerParticipantId', 'frames', 'stageStarts', 'result'}, 'ReplayView')
    metadata(value)
    require(value['frames'], 'empty replay')
    phases = []
    prior_sequence = 0
    for frame in value['frames']:
        fields(frame, {'sequence', 'at', 'actionText', 'state', 'ownerHoleCards'}, 'ReplayFrame')
        require(frame['sequence'] > prior_sequence, 'replay sequence order')
        prior_sequence = frame['sequence']
        hand_state(frame['state'], cards, replay=True)
        require(frame['state']['handId'] == value['handId'], 'replay hand association')
        if frame['ownerHoleCards'] is not None:
            require(len(frame['ownerHoleCards']) == len(set(frame['ownerHoleCards'])) == 2 and set(frame['ownerHoleCards']) <= cards, 'replay owner card pair')
            owner_shown = next((p['cards'] for p in frame['state']['showdownCards'] if p['participantId'] == value['viewerParticipantId']), None)
            if owner_shown is not None:
                require(frame['ownerHoleCards'] == owner_shown, 'replay owner/public cards differ')
        require(sum(p['stack'] + p['handCommitted'] for p in frame['state']['players']) == row['context']['initialChipTotal'], 'replay chip conservation')
        if not phases or phases[-1]['phase'] != frame['state']['phase']:
            phases.append({'phase': frame['state']['phase'], 'sequence': frame['sequence']})
    require(phases == value['stageStarts'], 'stage index')
    require(value['frames'][-1]['at'] <= value['serverTime'], 'replay events cannot be in the future')
    result = value['result']
    require(result is not None, 'settled sample needs result')
    fields(result, RESULT, 'HandResult')
    final = value['frames'][-1]['state']
    require(final['phase'] == result['phase'] == 'settled', 'replay terminal phase')
    require(result['handId'] == value['handId'], 'result hand association')
    require({p['participantId']: p['stack'] for p in final['players']} == {p['participantId']: p['stack'] for p in result['finalStacks']}, 'replay final stacks')
    shown = {p['participantId']: p['cards'] for p in result['showdownCards']}
    for pot in result['pots']:
        require(sum(p['amount'] for p in pot['allocations']) == pot['amount'], 'award arithmetic')
        require(set(pot['winnerParticipantIds']) <= set(pot['eligibleParticipantIds']), 'winner eligibility')
        scores = {owner: evaluate(result['board'] + shown[owner]) for owner in pot['eligibleParticipantIds']}
        best = max(scores.values())
        require(sorted(owner for owner, score in scores.items() if score == best) == sorted(pot['winnerParticipantIds']), 'replay winner fact')
        require(best[0] == pot['winningCategory'], 'replay category fact')
    private_ids = row['context'].get('privateCardIds', [])
    require(not any(card in json.dumps(value, ensure_ascii=False) for card in private_ids), 'folded card leak')


def audit():
    w01 = runpy.run_path(str(ROOT / 'scripts/validate-w01.py'))
    strict_json = w01['strict_json']
    rows = strict_json(EXAMPLES_PATH.read_text(encoding='utf-8'))
    fixtures = strict_json((ROOT / 'tests/fixtures/scenarios.json').read_text(encoding='utf-8'))
    fixture_ids = {row['id'] for row in fixtures}
    cards = set(w01['DECK'])
    paths = [ROOT / f'packages/protocol/src/{name}.ts' for name in ('commands', 'views', 'errors')]
    commands, views, errors = [path.read_text(encoding='utf-8') for path in paths]
    def map_entries(text, name):
        body = re.search(r'export interface ' + name + r'\s*\{(.*?)\n\}', text, re.S).group(1)
        return dict(re.findall(r"'([^']+)':\s*([A-Za-z]+);", body))
    mutations = map_entries(commands, 'MutatingCommandMap')
    identities = map_entries(commands, 'IdentityRequestMap')
    queries = map_entries(commands, 'QueryRequestMap')
    server_events = map_entries(views, 'ServerEventMap')
    require(len(mutations) == 11 and len(identities) == 2 and len(queries) == 2, 'request maps')
    require(set(mutations) | set(identities) | set(queries) == set(REQUEST_FIELDS), 'request names')
    require(len(server_events) == 5, 'server events')
    codes = set(re.findall(r"'([A-Z_]+)'", errors.split('export type ErrorCode =', 1)[1].split(';', 1)[0]))
    require(len(codes) == 23, 'error code coverage')
    error_doc = (ROOT / 'docs/errors.md').read_text(encoding='utf-8')
    require(set(re.findall(r'^\| ([A-Z_]+) \|', error_doc, re.M)) == codes, 'error documentation differs from types')
    protocol_doc = (ROOT / 'docs/protocol.md').read_text(encoding='utf-8')
    documented = set(re.findall(r'^\| ([a-z]+:[a-z:]+) \|', protocol_doc, re.M))
    require(documented == set(REQUEST_FIELDS) | set(server_events), 'documented event names')
    for path, text in zip(paths, (commands, views, errors)):
        require(not re.search(r'^\s*(?:export\s+)?(?:const|let|function|class)\b', text, re.M), 'runtime implementation in pure types')
        require(not re.search(r'^import(?! type\b)', text, re.M), 'runtime import in type package')
        for dependency in re.findall(r"from '([^']+)'", text):
            require(dependency.startswith('./') and (path.parent / dependency).with_suffix('.ts').is_file(), 'invalid type dependency')
    require(len(rows) == 14 and {row['id'] for row in rows} == {f'W02-{i:02}' for i in range(1, 15)}, 'example IDs')
    require(sum(row['response']['ok'] is True for row in rows) == 8, 'expected 8 successes')
    require(sum(row['response']['ok'] is False for row in rows) == 6, 'expected 6 failures')
    banned = {'deck', 'burnCards', 'tokenHash', 'botPrivateState', 'payloadHash', 'actorScope', 'stackTrace'}
    for row in rows:
        fields(row, {'id', 'event', 'audience', 'description', 'request', 'response', 'emittedEvents', 'relatedScenarioIds', 'context'}, 'example')
        event, request, response = row['event'], row['request'], row['response']
        require(event in REQUEST_FIELDS, 'unknown request event')
        fields(request, REQUEST_FIELDS[event], event + ' request')
        require(row['relatedScenarioIds'] and set(row['relatedScenarioIds']) <= fixture_ids, 'unknown W01 reference')
        key = 'commandId' if event in mutations else 'requestId'
        uuid.UUID(request[key])
        require(response[key] == request[key], 'correlation mismatch')
        metadata(response)
        if response['ok']:
            if event in mutations:
                fields(response, META | {'commandId', 'ok', 'duplicate', 'roomId', 'appliedRoomVersion', 'handId', 'appliedHandVersion'}, 'CommandSuccess')
                require((response['handId'] is None) == (response['appliedHandVersion'] is None), 'affected hand pair')
            elif event == 'session:guest':
                fields(response, META | {'requestId', 'ok', 'sessionId', 'resumeToken', 'expiresAt', 'connectionGeneration'}, 'GuestIssued')
            elif event == 'session:resume':
                base = META | {'requestId', 'ok', 'sessionId', 'expiresAt', 'connectionGeneration', 'outcome'}
                if response['outcome'] == 'seatRestored':
                    fields(response, base | {'participantId', 'roomView', 'playerView'}, 'restored seat')
                    room_view(response['roomView'])
                    if response['playerView'] is not None:
                        player_view(response['playerView'], cards)
                        require(response['participantId'] == response['playerView']['self']['participantId'], 'resume owner')
                elif response['outcome'] == 'identityOnly':
                    fields(response, base | {'reason', 'roomView', 'playerView'}, 'identity only')
                    require(response['roomView'] is None and response['playerView'] is None, 'expired seat view')
                else:
                    fields(response, base | {'interruptedHandId', 'roomView', 'playerView'}, 'interrupted')
                    require(response['outcome'] == 'handInterrupted' and response['roomView'] is None and response['playerView'] is None, 'interrupted resume')
            elif event == 'replay:get':
                replay_view(response, row, cards, w01['audit_card_value'])
        else:
            fields(response, FAILURE | ({'commandId', 'duplicate'} if event in mutations else {'requestId'}), 'failure')
            require(response['code'] in codes, 'unknown error')
            require(response['retryable'] is False and response['retryAfterMs'] is None, 'failure retry policy')
            if response['code'] in ('SESSION_EXPIRED', 'REPLAY_FORBIDDEN', 'ROOM_FULL'):
                require(all(response[key] is None for key in ('roomId', 'handId', 'latestRoomVersion', 'latestHandVersion')), 'unauthorized metadata leak')
        if event == 'game:action':
            action = request['action']
            require(action['type'] in ACTIONS, 'unknown action')
            fields(action, {'type', 'raiseTo'} if action['type'] in ('bet', 'raise') else {'type'}, 'Action')
            if response['ok']:
                require(request['action']['raiseTo'] - row['context']['actorBefore']['streetCommitted'] == row['context']['additionalAmount'], 'raise amount semantics')
                require(response['handId'] == request['handId'] and response['appliedHandVersion'] == request['expectedVersion'] + 1, 'hand acknowledgement')
        for index, emission in enumerate(row['emittedEvents']):
            fields(emission, {'event', 'audience', 'payload'}, 'emitted event')
            require(emission['event'] in server_events, 'unknown server event')
            if emission['event'] == 'room:view':
                room_view(emission['payload'])
            elif emission['event'] == 'game:view':
                require(emission['audience'] == 'participant:' + emission['payload']['self']['participantId'], 'private view broadcast')
                player_view(emission['payload'], cards)
        wire = {'request': request, 'response': response, 'emittedEvents': row['emittedEvents']}
        for path, value in walk(wire):
            require(path[-1] not in banned, 'private internal field: ' + '.'.join(path))
            if path[-1] == 'resumeToken':
                allowed = (event == 'session:resume' and path == ('request', 'resumeToken')) or (event == 'session:guest' and response['ok'] and path == ('response', 'resumeToken'))
                require(allowed and value.startswith('example_only_'), 'resume token leaked outside identity exchange')
        require(not any(card in json.dumps(wire, ensure_ascii=False) for card in row['context'].get('privateCardIds', [])), 'private card in wire payload')
    baseline = strict_json((ROOT / 'docs/verification/w01-validation.json').read_text(encoding='utf-8'))
    for relative, digest in baseline['sha256'].items():
        require(hashlib.sha256((ROOT / relative).read_bytes()).hexdigest() == digest, 'W01 input changed: ' + relative)
    documents = [ROOT / f'docs/{name}.md' for name in ('data-model', 'protocol', 'errors')]
    for path in documents:
        text = path.read_text(encoding='utf-8')
        require(len(re.findall(r'^```', text, re.M)) % 2 == 0, 'code fences')
        for target in re.findall(r'\]\(([^)]+)\)', text):
            if not target.startswith(('https://', 'http://')):
                require((path.parent / target).is_file(), 'broken documentation link: ' + target)
    inputs = [*paths, *documents, EXAMPLES_PATH, Path(__file__).resolve()]
    return {
        'status': 'passed', 'baselineDate': '2026-10-30', 'scope': 'W02 documentation, pure declarations and example audit',
        'clientRequests': 15, 'mutatingCommands': 11, 'serverEvents': 5, 'errorCodes': 23,
        'examples': 14, 'successExamples': 8, 'failureExamples': 6, 'replayFrames': 16,
        'checks': ['closed example payload shapes', 'request/response IDs', 'event and error names match declarations/docs', 'owner/public views', 'legal amount fields', 'fixed replay card/winner/settlement facts', 'replay chip conservation', 'credential and hidden-card boundaries', 'W01 input fingerprints', 'local documentation links', 'type-only import boundaries'],
        'typescriptCompiled': False, 'runtimeInputValidationImplemented': False, 'serverStarted': False, 'networkTestsRun': False,
        'sha256': {str(path.relative_to(ROOT)).replace('\\', '/'): hashlib.sha256(path.read_bytes()).hexdigest() for path in inputs},
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    try:
        report = audit()
    except (ValueError, TypeError, KeyError, OSError, StopIteration, AttributeError) as exc:
        report = {'status': 'failed', 'error': str(exc)}
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({key: value for key, value in report.items() if key != 'sha256'}, ensure_ascii=True, indent=2))
    return 0 if report['status'] == 'passed' else 1


if __name__ == '__main__':
    raise SystemExit(main())
