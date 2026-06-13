// Copyright Hollow Block. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Character.h"
#include "HLCharacter.generated.h"

class UCameraComponent;
class USpotLightComponent;
class UHLFlashlightComponent;
class UHLComposureComponent;
class UInputAction;
class UInputMappingContext;
struct FInputActionValue;

/**
 * First-person player pawn for Hollow Block. Provides walk/crouch/sprint movement
 * with stamina, mouse look, a head-mounted flashlight, a composure (sanity) model,
 * and a forward line-trace interaction probe that talks to IHLInteractableInterface.
 *
 * Input is Enhanced Input: assign the InputActions / mapping context on the
 * Blueprint child (see README). The class binds them in SetupPlayerInputComponent.
 */
UCLASS()
class HOLLOWBLOCK_API AHLCharacter : public ACharacter
{
	GENERATED_BODY()

public:
	AHLCharacter();

	virtual void Tick(float DeltaSeconds) override;
	virtual void SetupPlayerInputComponent(UInputComponent* PlayerInputComponent) override;

	UFUNCTION(BlueprintPure, Category = "HollowBlock")
	UHLFlashlightComponent* GetFlashlight() const { return Flashlight; }

	UFUNCTION(BlueprintPure, Category = "HollowBlock")
	UHLComposureComponent* GetComposure() const { return Composure; }

	/** The actor currently under the interaction probe, or null. */
	UFUNCTION(BlueprintPure, Category = "HollowBlock")
	AActor* GetFocusedInteractable() const { return FocusedActor; }

	/** Add a key item to the inventory (called by pickups). */
	UFUNCTION(BlueprintCallable, Category = "HollowBlock|Inventory")
	void AddKey(FName KeyTag);

	UFUNCTION(BlueprintPure, Category = "HollowBlock|Inventory")
	bool HasKey(FName KeyTag) const { return KeyTag.IsNone() || CollectedKeys.Contains(KeyTag); }

protected:
	virtual void BeginPlay() override;

	// --- Input handlers ---
	void Move(const FInputActionValue& Value);
	void Look(const FInputActionValue& Value);
	void StartSprint();
	void StopSprint();
	void ToggleCrouch();
	void OnInteract();
	void OnToggleFlashlight();

	// --- Components ---
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "HollowBlock|Components")
	TObjectPtr<UCameraComponent> Camera;

	/** Head-mounted spotlight the flashlight component drives. */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "HollowBlock|Components")
	TObjectPtr<USpotLightComponent> FlashlightLight;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "HollowBlock|Components")
	TObjectPtr<UHLFlashlightComponent> Flashlight;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "HollowBlock|Components")
	TObjectPtr<UHLComposureComponent> Composure;

	// --- Movement tuning ---
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "HollowBlock|Movement", meta = (ClampMin = "0.0"))
	float WalkSpeed = 220.f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "HollowBlock|Movement", meta = (ClampMin = "0.0"))
	float SprintSpeed = 430.f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "HollowBlock|Movement", meta = (ClampMin = "0.0"))
	float CrouchSpeed = 120.f;

	/** Seconds of continuous sprint available at full stamina. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "HollowBlock|Movement", meta = (ClampMin = "0.1"))
	float MaxStaminaSeconds = 6.f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "HollowBlock|Movement", meta = (ClampMin = "0.0"))
	float StaminaRecoveryPerSecond = 1.5f;

	// --- Interaction tuning ---
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "HollowBlock|Interaction", meta = (ClampMin = "0.0"))
	float InteractionDistance = 220.f;

	/** Light level (0..1) below which the character is considered "in darkness" for composure. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "HollowBlock|Composure", meta = (ClampMin = "0.0", ClampMax = "1.0"))
	float DarknessThreshold = 0.2f;

	// --- Enhanced Input (assign on the Blueprint child) ---
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "HollowBlock|Input")
	TObjectPtr<UInputMappingContext> DefaultMappingContext;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "HollowBlock|Input")
	TObjectPtr<UInputAction> MoveAction;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "HollowBlock|Input")
	TObjectPtr<UInputAction> LookAction;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "HollowBlock|Input")
	TObjectPtr<UInputAction> SprintAction;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "HollowBlock|Input")
	TObjectPtr<UInputAction> CrouchAction;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "HollowBlock|Input")
	TObjectPtr<UInputAction> InteractAction;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "HollowBlock|Input")
	TObjectPtr<UInputAction> FlashlightAction;

private:
	void UpdateInteractionProbe();
	void UpdateDarkness();
	void UpdateStamina(float DeltaSeconds);
	bool IsFlashlightIlluminatingSelf() const;

	UPROPERTY(Transient)
	TObjectPtr<AActor> FocusedActor;

	/** Tags of key items the player is carrying. */
	UPROPERTY(Transient)
	TSet<FName> CollectedKeys;

	float Stamina = 0.f;
	bool bWantsToSprint = false;
};
