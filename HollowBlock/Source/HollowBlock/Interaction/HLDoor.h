// Copyright Hollow Block. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "Interaction/HLInteractableInterface.h"
#include "HLDoor.generated.h"

class UStaticMeshComponent;

DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnDoorOpened, AHLDoor*, Door);

/**
 * A hinged door the player swings open/closed. Can be locked behind a required key
 * tag; interacting without the key fires a "rattle" Blueprint event and stays shut.
 * The actual swing animation is left to a Blueprint timeline driven by OnSwing — C++
 * owns the state (open/locked) so designers only handle the visuals.
 */
UCLASS()
class HOLLOWBLOCK_API AHLDoor : public AActor, public IHLInteractableInterface
{
	GENERATED_BODY()

public:
	AHLDoor();

	// IHLInteractableInterface
	virtual void Interact_Implementation(AActor* Interactor) override;
	virtual FText GetInteractText_Implementation() const override;
	virtual bool CanInteract_Implementation(AActor* Interactor) const override;

	UFUNCTION(BlueprintPure, Category = "Door")
	bool IsOpen() const { return bIsOpen; }

	UFUNCTION(BlueprintPure, Category = "Door")
	bool IsLocked() const { return bLocked; }

	/** Unlock without a key, e.g. from a scripted event. */
	UFUNCTION(BlueprintCallable, Category = "Door")
	void Unlock() { bLocked = false; }

	/** Implement the visual swing in Blueprint (timeline rotating DoorMesh). */
	UFUNCTION(BlueprintImplementableEvent, Category = "Door")
	void OnSwing(bool bOpen);

	/** Played when the player tries a locked door without the key. */
	UFUNCTION(BlueprintImplementableEvent, Category = "Door")
	void OnRattleLocked();

	UPROPERTY(BlueprintAssignable, Category = "Door")
	FOnDoorOpened OnDoorOpened;

protected:
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Door")
	TObjectPtr<USceneComponent> Hinge;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Door")
	TObjectPtr<UStaticMeshComponent> DoorMesh;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Door")
	bool bLocked = false;

	/** Key tag required to unlock. Empty means it can never be unlocked by key (script only). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Door", meta = (EditCondition = "bLocked"))
	FName RequiredKeyTag = NAME_None;

private:
	bool bIsOpen = false;
};
