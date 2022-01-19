import { Address, store } from "@graphprotocol/graph-ts";
import { Transfer } from "../generated/IERC721/IERC721";
import { PromissoryNote } from "../generated/schema";

import { getOrInitUser } from "./helpers";

const ZERO_ADDRESS = Address.zero();

export function handleTransfer(event: Transfer): void {
  const contractAddress = event.address;
  const tokenId = event.params.tokenId;
  const noteId = `${contractAddress.toHexString()}-${tokenId.toString()}`;

  // mint
  if (event.params.from.equals(ZERO_ADDRESS)) {
    const toUser = getOrInitUser(event.params.to);
    const promissoryNote = new PromissoryNote(noteId);
    promissoryNote.contractAddress = contractAddress;
    promissoryNote.tokenId = tokenId;
    promissoryNote.owner = toUser.id;
    promissoryNote.save();
  }
  // burn
  else if (event.params.to.equals(ZERO_ADDRESS)) {
    const promissoryNote = PromissoryNote.load(noteId);
    if (promissoryNote) {
      store.remove("PromissoryNote", noteId);
    }
  }
  // transfer
  else {
    const toUser = getOrInitUser(event.params.to);
    const promissoryNote = PromissoryNote.load(noteId);
    if (promissoryNote) {
      promissoryNote.owner = toUser.id;
      promissoryNote.save();
    }
  }
}
