// Copyright Hollow Block. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "UObject/Interface.h"
#include "HLInteractableInterface.generated.h"

UINTERFACE(MinimalAPI, Blueprintable)
class UHLInteractableInterface : public UInterface
{
	GENERATED_BODY()
};

/**
 * Implemented by anything the player can focus on and interact with
 * (doors, pickups, notes, switches). The player performs a forward line-trace;
 * if it hits an actor implementing this interface, the prompt text is shown and
 * Interact() is called on use.
 */
class HOLLOWBLOCK_API IHLInteractableInterface
{
	GENERATED_BODY()

public:
	/** Called when the player presses the interact key while focusing this actor. */
	UFUNCTION(BlueprintNativeEvent, BlueprintCallable, Category = "Interaction")
	void Interact(AActor* Interactor);

	/** Prompt text to display while focused, e.g. "Open door" or "Read note". */
	UFUNCTION(BlueprintNativeEvent, BlueprintCallable, Category = "Interaction")
	FText GetInteractText() const;

	/** Whether the actor can currently be interacted with (e.g. a locked door may refuse). */
	UFUNCTION(BlueprintNativeEvent, BlueprintCallable, Category = "Interaction")
	bool CanInteract(AActor* Interactor) const;
};
